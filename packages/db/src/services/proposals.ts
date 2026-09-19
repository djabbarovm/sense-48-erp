/**
 * P-28: коммерческое предложение (подборка) клиенту — docs/21 §3 «PROPERTY_SELECTED → подборка / КП».
 * Менеджер выбирает до 6 помещений, система даёт ссылку без входа; клиент видит только публичные поля юнитов
 * (без собственника и арендатора), первое открытие и запрос показа фиксируются как активности и уходят менеджеру в бот.
 */
import { randomBytes } from 'node:crypto';
import type { TenantContext } from '@finance-os/core';
import { NotFoundError, ValidationError, requirePermission } from '@finance-os/core';
import type { DealProposal } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404 } from '../repository.js';
import { addDealActivity, updateDeal } from './deals.js';

const MAX_UNITS = 6;
const appUrl = () => (process.env.APP_URL ?? '').replace(/\/$/, '');
export const proposalUrl = (token: string) => `${appUrl()}/p/${token}`;

export async function createProposal(ctx: TenantContext, dealId: string, input: { unitIds: string[]; note?: string | null; validDays?: number }, now = new Date()): Promise<DealProposal> {
  requirePermission(ctx, 'deal.manage');
  const unitIds = [...new Set(input.unitIds.filter(Boolean))];
  if (unitIds.length === 0) throw new ValidationError('UNITS_REQUIRED', 'UNITS_REQUIRED: выберите хотя бы одно помещение');
  if (unitIds.length > MAX_UNITS) throw new ValidationError('TOO_MANY_UNITS', `TOO_MANY_UNITS: не более ${MAX_UNITS}`);
  const deal = await findScopedOr404(prisma.deal, ctx, dealId);
  if (['WON', 'LOST'].includes(deal.stage)) throw new ValidationError('DEAL_CLOSED');
  const units = await prisma.unit.findMany({ where: { tenantId: ctx.tenantId, id: { in: unitIds } }, select: { id: true, unitNo: true } });
  if (units.length !== unitIds.length) throw new NotFoundError('UNIT_NOT_FOUND');
  const validDays = input.validDays ?? 7;
  const created = await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const p = await tx.dealProposal.create({ data: { tenantId: ctx.tenantId, dealId, token: randomBytes(12).toString('base64url'), unitIds, note: input.note?.trim() || null, validUntil: new Date(now.getTime() + validDays * 86_400_000), createdBy: ctx.userId } });
    return { result: p, audit: { action: 'deal.proposal.create', objectType: 'deal', objectId: dealId, after: { proposalId: p.id, units: units.map((u) => u.unitNo), validDays } } };
  });
  await addDealActivity(ctx, dealId, { kind: 'OFFER', note: `КП отправлено: ${units.map((u) => u.unitNo).join(', ')}${input.note ? ` — ${input.note.trim()}` : ''}` });
  await updateDeal(ctx, dealId, { nextAction: 'Узнать реакцию на КП', nextActionAt: new Date(now.getTime() + 2 * 86_400_000) });
  return created;
}

export async function listProposals(ctx: TenantContext, dealId: string) {
  requirePermission(ctx, 'deal.view');
  await findScopedOr404(prisma.deal, ctx, dealId);
  const rows = await prisma.dealProposal.findMany({ where: { tenantId: ctx.tenantId, dealId }, orderBy: { createdAt: 'desc' } });
  const units = await prisma.unit.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.unitIds))] } }, select: { id: true, unitNo: true } });
  const no = new Map(units.map((u) => [u.id, u.unitNo]));
  return rows.map((r) => ({ ...r, url: proposalUrl(r.token), unitNos: r.unitIds.map((id) => no.get(id) ?? '—') }));
}

/** Публичная выдача по токену (без auth): только публичные поля юнитов; первое открытие фиксируется. */
export async function getPublicProposal(token: string, now = new Date()) {
  const p = await prisma.dealProposal.findUnique({ where: { token }, include: { deal: { select: { id: true, contactName: true, managerId: true, tenantId: true } } } });
  if (!p) return null;
  const expired = !!p.validUntil && p.validUntil < now;
  const [units, tenant, manager] = await Promise.all([
    prisma.unit.findMany({ where: { id: { in: p.unitIds } }, select: { id: true, unitNo: true, type: true, areaM2: true, askingRateMinor: true, askingCurrency: true, readiness: true, building: { select: { name: true } }, floor: { select: { floorNo: true } } } }),
    prisma.tenant.findUniqueOrThrow({ where: { id: p.tenantId }, select: { legalName: true } }),
    prisma.user.findUnique({ where: { id: p.deal.managerId }, select: { fullName: true } }),
  ]);
  if (!expired) await prisma.dealProposal.update({ where: { id: p.id }, data: { viewsCount: { increment: 1 }, ...(p.viewedAt ? {} : { viewedAt: now }) } });
  return {
    id: p.id, token, note: p.note, validUntil: p.validUntil, expired, clientFirstName: p.deal.contactName.split(/\s+/)[0] ?? '', company: tenant.legalName, managerName: manager?.fullName.split(/\s+/)[0] ?? '', requested: !!p.viewingRequestedAt,
    units: p.unitIds.map((id) => units.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => !!u).map((u) => ({ id: u.id, unitNo: u.unitNo, type: u.type, areaM2: Number(u.areaM2), askingRateMinor: u.askingRateMinor, currency: u.askingCurrency, readiness: u.readiness, building: u.building.name, floorNo: u.floor.floorNo })),
  };
}

/** Клиент нажал «Записаться на показ»: активность + следующий шаг менеджеру. Один запрос на КП. */
export async function requestViewingFromProposal(token: string, input: { note?: string | null }, now = new Date()): Promise<boolean> {
  const p = await prisma.dealProposal.findUnique({ where: { token }, include: { deal: { select: { id: true, managerId: true, tenantId: true, stage: true } } } });
  if (!p || (p.validUntil && p.validUntil < now) || p.viewingRequestedAt || ['WON', 'LOST'].includes(p.deal.stage)) return false;
  const note = input.note?.trim().slice(0, 300) || null;
  await withAudit({ tenantId: p.tenantId, userId: p.deal.managerId }, async (tx) => {
    await tx.dealProposal.update({ where: { id: p.id }, data: { viewingRequestedAt: now, requestNote: note } });
    await tx.unitActivity.create({ data: { tenantId: p.tenantId, dealId: p.deal.id, kind: 'FOLLOW_UP', note: `Клиент запросил показ по КП${note ? `: ${note}` : ''}`, source: 'API', actorId: p.deal.managerId, happenedAt: now, followUpAt: now } });
    await tx.deal.update({ where: { id: p.deal.id }, data: { nextAction: 'Назначить показ (запрос из КП)', nextActionAt: now } });
    return { result: null, audit: { action: 'deal.proposal.viewing_request', objectType: 'deal', objectId: p.deal.id, after: { proposalId: p.id, hasNote: !!note } } };
  });
  return true;
}

/** Для crm-reminders: непрочитанные события КП (первый просмотр, запрос показа) → менеджеру. */
export async function pendingProposalNotices(tenantId: string) {
  const rows = await prisma.dealProposal.findMany({ where: { tenantId, OR: [{ viewedAt: { not: null }, viewNotifiedAt: null }, { viewingRequestedAt: { not: null }, requestNotifiedAt: null }] }, include: { deal: { select: { id: true, managerId: true, contactName: true } } } });
  return rows.map((r) => ({ id: r.id, dealId: r.deal.id, managerId: r.deal.managerId, contactName: r.deal.contactName, viewed: !!r.viewedAt && !r.viewNotifiedAt, requested: !!r.viewingRequestedAt && !r.requestNotifiedAt, requestNote: r.requestNote, viewsCount: r.viewsCount }));
}
export async function markProposalNotified(id: string, what: { viewed?: boolean; requested?: boolean }, now = new Date()) {
  await prisma.dealProposal.update({ where: { id }, data: { ...(what.viewed ? { viewNotifiedAt: now } : {}), ...(what.requested ? { requestNotifiedAt: now } : {}) } });
}
