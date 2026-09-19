/**
 * P-26: звонки из телефонии → активности CRM (docs/21 §7). Клиент ищется по телефону (контакт → активная сделка,
 * иначе собственник); неизвестный входящий → лид «Входящий звонок»; пропущенный → следующий шаг «перезвонить».
 * Дедупликация по externalRef. Ссылка на запись хранится, показывается только c deal.contact.view.
 */
import type { TelephonyEvent } from '@finance-os/adapters';
import { normalizePhone, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { createDeal } from './deals.js';

export interface CallIngestResult { status: 'DUPLICATE' | 'IGNORED' | 'DEAL_ACTIVITY' | 'OWNER_ACTIVITY' | 'NEW_LEAD'; dealId?: string; ownerId?: string; activityId?: string }

async function actorFor(tenantId: string, ext: string | null, fallback: string | null): Promise<{ userId: string; roles: RoleCode[] } | null> {
  // сотрудник по внутреннему номеру (User.phoneExt нет — используем tenant.settings.telephony_ext_map {ext: userId}), иначе менеджер сделки / дежурный
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const map = ((t?.settings as Record<string, unknown> | null)?.telephony_ext_map ?? {}) as Record<string, string>;
  const userId = (ext && map[ext]) || fallback || (await prisma.userTenantRole.findFirst({ where: { tenantId, role: 'COMMERCIAL_MANAGER' }, select: { userId: true } }))?.userId || null;
  if (!userId) return null;
  const roles = (await prisma.userTenantRole.findMany({ where: { tenantId, userId }, select: { role: true } })).map((r) => r.role as RoleCode);
  return { userId, roles };
}

export async function ingestCallEvent(tenantId: string, ev: TelephonyEvent, now = new Date()): Promise<CallIngestResult> {
  if (await prisma.unitActivity.findFirst({ where: { tenantId, externalRef: ev.externalId }, select: { id: true } })) return { status: 'DUPLICATE' };
  let phone: string | null; try { phone = normalizePhone(ev.clientPhone); } catch { return { status: 'IGNORED' }; }
  if (!phone) return { status: 'IGNORED' };
  const missed = ev.kind === 'CALL_MISSED';
  const note = `${ev.direction === 'IN' ? 'Входящий' : 'Исходящий'} звонок${missed ? ' — пропущен' : ` ${Math.round(ev.durationSec / 60)} мин`}`;
  const contact = await prisma.contact.findFirst({ where: { tenantId, OR: [{ phone }, { phoneAlt: phone }] }, include: { deals: { where: { stage: { notIn: ['WON', 'LOST'] } }, orderBy: { updatedAt: 'desc' }, take: 1, select: { id: true, managerId: true, unitId: true } } } });
  const deal = contact?.deals[0] ?? null;
  const slug = (await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { slug: true } })).slug;
  if (deal) {
    const actor = await actorFor(tenantId, ev.employeeExt, deal.managerId);
    if (!actor) return { status: 'IGNORED' };
    return withAudit({ tenantId, userId: actor.userId }, async (tx) => {
      const a = await tx.unitActivity.create({ data: { tenantId, dealId: deal.id, unitId: deal.unitId, kind: 'CALL', note, source: 'PHONE', actorId: actor.userId, happenedAt: new Date(ev.startedAt), durationSec: ev.durationSec, recordingUrl: ev.recordingUrl, callDirection: ev.direction, externalRef: ev.externalId, ...(missed ? { followUpAt: now } : {}) } });
      if (missed) await tx.deal.update({ where: { id: deal.id }, data: { nextAction: 'Перезвонить (пропущенный звонок)', nextActionAt: now } });
      return { result: { status: 'DEAL_ACTIVITY' as const, dealId: deal.id, activityId: a.id }, audit: { action: 'call.ingest', objectType: 'deal', objectId: deal.id, after: { direction: ev.direction, missed, durationSec: ev.durationSec, hasRecording: !!ev.recordingUrl } } };
    });
  }
  const owner = contact?.ownerId ? await prisma.propertyOwner.findFirst({ where: { tenantId, id: contact.ownerId } }) : await (async () => { const owners = await prisma.propertyOwner.findMany({ where: { tenantId, contactPhone: { not: null } }, select: { id: true, contactPhone: true, managerId: true } }); return owners.find((o) => { try { return normalizePhone(o.contactPhone) === phone; } catch { return false; } }) ?? null; })();
  if (owner) {
    const actor = await actorFor(tenantId, ev.employeeExt, owner.managerId);
    if (!actor) return { status: 'IGNORED' };
    return withAudit({ tenantId, userId: actor.userId }, async (tx) => {
      const a = await tx.unitActivity.create({ data: { tenantId, ownerId: owner.id, kind: 'CALL', note: `${note} (собственник)`, source: 'PHONE', actorId: actor.userId, happenedAt: new Date(ev.startedAt), durationSec: ev.durationSec, recordingUrl: ev.recordingUrl, callDirection: ev.direction, externalRef: ev.externalId } });
      if (missed) await tx.propertyOwner.update({ where: { id: owner.id }, data: { nextAction: 'Перезвонить (пропущенный звонок)', nextActionAt: now } });
      return { result: { status: 'OWNER_ACTIVITY' as const, ownerId: owner.id, activityId: a.id }, audit: { action: 'call.ingest', objectType: 'property_owner', objectId: owner.id, after: { direction: ev.direction, missed } } };
    });
  }
  if (ev.direction === 'OUT') return { status: 'IGNORED' }; // исходящий на незнакомый номер — не лид
  const actor = await actorFor(tenantId, ev.employeeExt, null);
  if (!actor) return { status: 'IGNORED' };
  const ctx = unsafeCreateTenantContext({ tenantId, tenantSlug: slug, userId: actor.userId, roles: actor.roles.length ? actor.roles : ['COMMERCIAL_MANAGER'] });
  const d = await createDeal(ctx, { contactName: `Входящий ${phone.slice(-4)}`, contactPhone: phone, source: 'OTHER', nextAction: missed ? 'Перезвонить (пропущенный звонок)' : 'Квалифицировать лид после звонка', nextActionAt: now, purpose: note });
  const a = await prisma.unitActivity.create({ data: { tenantId, dealId: d.id, kind: 'CALL', note, source: 'PHONE', actorId: actor.userId, happenedAt: new Date(ev.startedAt), durationSec: ev.durationSec, recordingUrl: ev.recordingUrl, callDirection: ev.direction, externalRef: ev.externalId } });
  return { status: 'NEW_LEAD', dealId: d.id, activityId: a.id };
}
