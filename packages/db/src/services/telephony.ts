/**
 * P-26: звонки из телефонии → активности CRM (docs/21 §7). Клиент ищется по телефону (контакт → активная сделка,
 * иначе собственник); неизвестный входящий → лид «Входящий звонок»; пропущенный → следующий шаг «перезвонить».
 * Дедупликация по externalRef. Ссылка на запись хранится, показывается только c deal.contact.view.
 */
import type { TelephonyConfig, TelephonyEvent, TelephonyProvider } from '@finance-os/adapters';
import { TELEPHONY_PROVIDERS } from '@finance-os/adapters';
import { normalizePhone, requirePermission, unsafeCreateTenantContext, ValidationError, type RoleCode, type TenantContext } from '@finance-os/core';
import type { Prisma } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { createDeal } from './deals.js';

// ── P-29: настройки телефонии тенанта (`tenant.settings.telephony`, ADR-032) ──

export interface TelephonySettings extends TelephonyConfig {
  tzOffset: string;
  internalExtLen: number;
  /** Внутренний номер → userId сотрудника. */
  extMap: Record<string, string>;
  /** Диагностика: когда пришёл последний webhook и какие ключи были у последнего непонятого тела (значения не хранятся). */
  lastWebhookAt: string | null;
  lastUnparsed: { at: string; keys: string[] } | null;
}

function readTelephony(settings: unknown): TelephonySettings {
  const all = (settings ?? {}) as Record<string, unknown>;
  const t = (all.telephony ?? {}) as Record<string, unknown>;
  const provider = TELEPHONY_PROVIDERS.includes(t.provider as TelephonyProvider) ? (t.provider as TelephonyProvider) : 'generic';
  const legacy = (all.telephony_ext_map ?? {}) as Record<string, string>; // P-26: старое место карты
  const extMap = { ...legacy, ...((t.ext_map ?? {}) as Record<string, string>) };
  const fieldMap = t.field_map && typeof t.field_map === 'object' ? (t.field_map as TelephonyConfig['fieldMap']) : undefined;
  const lu = t.last_unparsed as { at?: string; keys?: string[] } | undefined;
  return {
    provider,
    tzOffset: typeof t.tz_offset === 'string' ? t.tz_offset : '+05:00',
    internalExtLen: typeof t.internal_ext_len === 'number' ? t.internal_ext_len : 4,
    ...(fieldMap ? { fieldMap } : {}),
    extMap,
    lastWebhookAt: typeof t.last_webhook_at === 'string' ? t.last_webhook_at : null,
    lastUnparsed: lu && Array.isArray(lu.keys) && typeof lu.at === 'string' ? { at: lu.at, keys: lu.keys } : null,
  };
}

export async function getTelephonySettings(tenantId: string): Promise<TelephonySettings> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  return readTelephony(t?.settings);
}

export interface TelephonySettingsInput {
  provider: TelephonyProvider;
  tzOffset: string;
  internalExtLen: number;
  /** Внутренний номер → email или userId сотрудника тенанта. */
  extMap: Record<string, string>;
  /** Переопределение имён полей провайдера (JSON), пусто — сброс к умолчаниям. */
  fieldMap?: TelephonyConfig['fieldMap'] | null;
}

/** Право tenant.settings (ADMIN). Сотрудник по email должен быть участником тенанта — иначе EXT_USER_NOT_FOUND. */
export async function updateTelephonySettings(ctx: TenantContext, input: TelephonySettingsInput): Promise<TelephonySettings> {
  requirePermission(ctx, 'tenant.settings');
  if (!TELEPHONY_PROVIDERS.includes(input.provider)) throw new ValidationError('TELEPHONY_PROVIDER_INVALID');
  if (!/^[+-]\d{2}:\d{2}$/.test(input.tzOffset)) throw new ValidationError('TZ_OFFSET_INVALID');
  if (!Number.isInteger(input.internalExtLen) || input.internalExtLen < 1 || input.internalExtLen > 6) throw new ValidationError('INTERNAL_EXT_LEN_INVALID');
  const members = await prisma.userTenantRole.findMany({ where: { tenantId: ctx.tenantId }, select: { userId: true, user: { select: { email: true } } } });
  const byEmail = new Map(members.filter((m) => m.user.email != null).map((m) => [m.user.email!.toLowerCase(), m.userId] as const));
  const ids = new Set(members.map((m) => m.userId));
  const extMap: Record<string, string> = {};
  for (const [extRaw, who] of Object.entries(input.extMap)) {
    const ext = extRaw.replace(/\D/g, '');
    if (!ext) continue;
    const userId = ids.has(who) ? who : byEmail.get(who.trim().toLowerCase());
    if (!userId) throw new ValidationError('EXT_USER_NOT_FOUND', `${ext} → ${who}`);
    extMap[ext] = userId;
  }
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.roles.join(',') }, async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
    const prev = readTelephony(before.settings);
    const all = { ...((before.settings ?? {}) as Record<string, unknown>) };
    delete all.telephony_ext_map;
    const prevT = (all.telephony ?? {}) as Record<string, unknown>;
    const nextT: Record<string, unknown> = { ...prevT, provider: input.provider, tz_offset: input.tzOffset, internal_ext_len: input.internalExtLen, ext_map: extMap };
    if (input.fieldMap && Object.keys(input.fieldMap).length) nextT.field_map = input.fieldMap; else delete nextT.field_map;
    all.telephony = nextT;
    const after = await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: all as Prisma.InputJsonValue }, select: { settings: true } });
    const next = readTelephony(after.settings);
    return {
      result: next,
      audit: {
        action: 'telephony.settings.update',
        objectType: 'tenant',
        objectId: ctx.tenantId,
        before: { provider: prev.provider, tzOffset: prev.tzOffset, internalExtLen: prev.internalExtLen, extMap: prev.extMap, fieldMap: prev.fieldMap ?? null },
        after: { provider: next.provider, tzOffset: next.tzOffset, internalExtLen: next.internalExtLen, extMap: next.extMap, fieldMap: next.fieldMap ?? null },
      },
    };
  });
}

/** Техническая отметка о webhook (без аудита): время последнего и ключи последнего непонятого тела — для настройки карты полей. */
export async function noteTelephonyWebhook(tenantId: string, parsed: boolean, keys: string[], now = new Date()): Promise<void> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  if (!t) return;
  const all = { ...((t.settings ?? {}) as Record<string, unknown>) };
  const cur = (all.telephony ?? {}) as Record<string, unknown>;
  all.telephony = { ...cur, last_webhook_at: now.toISOString(), ...(parsed ? {} : { last_unparsed: { at: now.toISOString(), keys: keys.slice(0, 40) } }) };
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: all as Prisma.InputJsonValue } });
}

export interface CallIngestResult { status: 'DUPLICATE' | 'IGNORED' | 'DEAL_ACTIVITY' | 'OWNER_ACTIVITY' | 'NEW_LEAD'; dealId?: string; ownerId?: string; activityId?: string }

async function actorFor(tenantId: string, ext: string | null, fallback: string | null): Promise<{ userId: string; roles: RoleCode[] } | null> {
  // сотрудник по внутреннему номеру (tenant.settings.telephony.ext_map {ext: userId}, P-29), иначе менеджер сделки / дежурный
  const map = (await getTelephonySettings(tenantId)).extMap;
  const userId = (ext && map[ext.replace(/\D/g, '')]) || fallback || (await prisma.userTenantRole.findFirst({ where: { tenantId, role: 'COMMERCIAL_MANAGER' }, select: { userId: true } }))?.userId || null;
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
