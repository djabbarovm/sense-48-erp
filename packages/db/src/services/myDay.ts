/**
 * CRM Tower — «Мой день» (docs/21 §5, P-23): личный экран сотрудника (mobile-first) и данные для дайджестов бота.
 * Менеджер/брокер видят своё (сделки managerId = я, собственники managerId = я, задачи мне); OWNER/ADMIN — всех.
 * Быстрые действия: звонок, показ, результат показа, следующий шаг, быстрый лид, задача сделана — через сервисы сделок/собственников.
 */
import type { TenantContext } from '@finance-os/core';
import { OWNER_ACTIVE_STAGES, ValidationError, can, hasRole, requirePermission, type OwnerStage } from '@finance-os/core';
import type { DealLostReason } from '@prisma/client';
import { prisma } from '../client.js';
import { addDealActivity, createDeal, listDeals, moveDeal, updateDeal, type DealRow } from './deals.js';
import { addOwnerActivity } from './ownerPipeline.js';
import { setTaskStatus } from './tasks.js';

const ACTIVE = ['NEW', 'QUALIFIED', 'PROPERTY_SELECTED', 'VIEWING', 'OFFER', 'NEGOTIATION', 'LOI', 'CONTRACT', 'MOVE_IN'];

/**
 * Вся команда, а не только «мои»: OWNER/ADMIN/лид финансов; колл-центр (вся входящая очередь —
 * лиды и собственники без менеджера его работа); коммерческий директор и CEO — надзор над всем
 * коммерческим потоком (ADR-038: у директора есть deal.manage → действия доступны; CEO без
 * deal.manage → тот же экран только для чтения).
 */
export function seesAll(ctx: TenantContext): boolean { return hasRole(ctx, 'OWNER', 'ADMIN', 'FINANCE_OPS_LEAD', 'CALL_CENTER', 'COMMERCIAL_DIRECTOR', 'CEO'); }

export interface MyDay {
  userId: string; seesAll: boolean; dayStart: Date; dayEnd: Date;
  viewings: { activityId: string; dealId: string; dealNumber: string; at: Date; unitNo: string | null; contactName: string; note: string; done: boolean }[];
  newLeads: DealRow[];
  overdue: DealRow[];
  noNextAction: DealRow[];
  dueToday: DealRow[];
  owners: { id: string; displayName: string; stage: OwnerStage; nextAction: string | null; nextActionAt: Date | null; overdue: boolean; unitNos: string[] }[];
  tasks: { id: string; type: string; nextAction: string; dueAt: Date | null; status: string; objectType: string; objectId: string }[];
  today: { calls: number; viewingsScheduled: number; leads: number; stageMoves: number };
  pipeline: { active: number; potentialMinor: bigint };
}

export async function getMyDay(ctx: TenantContext, now = new Date()): Promise<MyDay> {
  requirePermission(ctx, 'deal.view');
  const all = seesAll(ctx);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const mine = all ? {} : { managerId: ctx.userId };
  const deals = await listDeals(ctx, { ...mine }, now);
  const active = deals.filter((d) => ACTIVE.includes(d.stage));
  const dealIds = new Set(active.map((d) => d.id));
  const [viewingActs, owners, tasks, todayActs] = await Promise.all([
    prisma.unitActivity.findMany({ where: { tenantId: ctx.tenantId, kind: 'VIEWING', followUpAt: { gte: dayStart, lt: new Date(dayEnd.getTime() + 86_400_000) }, ...(all ? {} : { deal: { managerId: ctx.userId } }) }, include: { deal: { select: { id: true, number: true, contactName: true, stage: true } }, unit: { select: { unitNo: true } } }, orderBy: { followUpAt: 'asc' } }),
    can(ctx, 'owner.pipeline') ? prisma.propertyOwner.findMany({ where: { tenantId: ctx.tenantId, pipelineStage: { in: [...OWNER_ACTIVE_STAGES] }, ...(all ? {} : { managerId: ctx.userId }), OR: [{ nextActionAt: { lt: dayEnd } }, { nextActionAt: null, pipelineStage: 'LEAD' }] }, include: { units: { select: { unitNo: true } } }, orderBy: { nextActionAt: 'asc' }, take: 20 }) : Promise.resolve([]),
    prisma.task.findMany({ where: { tenantId: ctx.tenantId, status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] }, ...(all ? {} : { ownerId: ctx.userId }), OR: [{ dueAt: { lt: dayEnd } }, { dueAt: null }] }, orderBy: [{ dueAt: 'asc' }], take: 30 }),
    prisma.unitActivity.findMany({ where: { tenantId: ctx.tenantId, happenedAt: { gte: dayStart, lt: dayEnd }, ...(all ? {} : { actorId: ctx.userId }) }, select: { kind: true, note: true, dealId: true } }),
  ]);
  const leadsToday = await prisma.deal.count({ where: { tenantId: ctx.tenantId, createdAt: { gte: dayStart, lt: dayEnd }, ...(all ? {} : { managerId: ctx.userId }) } });
  return {
    userId: ctx.userId, seesAll: all, dayStart, dayEnd,
    viewings: viewingActs.filter((a) => a.deal && dealIds.has(a.deal.id) || all).map((a) => ({ activityId: a.id, dealId: a.deal?.id ?? '', dealNumber: a.deal?.number ?? '—', at: a.followUpAt!, unitNo: a.unit?.unitNo ?? null, contactName: a.deal?.contactName ?? '—', note: a.note, done: a.followUpAt! < now && !!a.deal && a.deal.stage !== 'VIEWING' })),
    newLeads: active.filter((d) => d.stage === 'NEW'),
    overdue: active.filter((d) => d.nextActionAt && d.nextActionAt < dayStart && d.stage !== 'NEW'),
    noNextAction: active.filter((d) => !d.nextAction && d.stage !== 'NEW'),
    dueToday: active.filter((d) => d.nextActionAt && d.nextActionAt >= dayStart && d.nextActionAt < dayEnd),
    owners: owners.map((o) => ({ id: o.id, displayName: o.displayName, stage: o.pipelineStage as OwnerStage, nextAction: o.nextAction, nextActionAt: o.nextActionAt, overdue: !!o.nextActionAt && o.nextActionAt < now, unitNos: o.units.map((u) => u.unitNo) })),
    tasks: tasks.map((t) => ({ id: t.id, type: t.type, nextAction: t.nextAction, dueAt: t.dueAt, status: t.status, objectType: t.objectType, objectId: t.objectId })),
    today: { calls: todayActs.filter((a) => a.kind === 'CALL').length, viewingsScheduled: todayActs.filter((a) => a.kind === 'VIEWING').length, leads: leadsToday, stageMoves: todayActs.filter((a) => a.kind === 'NOTE' && /Стадия|→/.test(a.note)).length },
    pipeline: { active: active.length, potentialMinor: active.reduce((a, d) => a + (d.expectedRateMinor ?? 0n), 0n) },
  };
}

// ── Быстрые действия (BR-P60/P61: показ — событие c датой, после действия — следующий шаг) ──

/** Звонок по сделке: активность CALL + следующий шаг. */
export async function quickCall(ctx: TenantContext, dealId: string, input: { note: string; nextAction?: string | null; nextActionAt?: Date | null }) {
  await addDealActivity(ctx, dealId, { kind: 'CALL', note: input.note, followUpAt: input.nextActionAt ?? null });
  if (input.nextAction !== undefined || input.nextActionAt !== undefined) await updateDeal(ctx, dealId, { nextAction: input.nextAction ?? null, nextActionAt: input.nextActionAt ?? null });
}

/** Назначить показ: активность VIEWING c датой (BR-P60), сделка → VIEWING, если ещё раньше; следующий шаг = провести показ. */
export async function scheduleViewing(ctx: TenantContext, dealId: string, input: { at: Date; unitId?: string | null; unitNo?: string | null; note?: string | null }, now = new Date()) {
  if (input.at < now) throw new ValidationError('VIEWING_IN_PAST', 'VIEWING_IN_PAST: показ назначается на будущее');
  const deal = await prisma.deal.findFirst({ where: { tenantId: ctx.tenantId, id: dealId } });
  if (!deal) throw new ValidationError('NOT_FOUND');
  let unitId = input.unitId ?? null;
  if (!unitId && input.unitNo) unitId = (await prisma.unit.findFirst({ where: { tenantId: ctx.tenantId, unitNo: { equals: input.unitNo.trim(), mode: 'insensitive' } }, select: { id: true } }))?.id ?? null;
  if (input.unitNo && !unitId) throw new ValidationError('UNIT_NOT_FOUND', `UNIT_NOT_FOUND: ${input.unitNo}`);
  if (!deal.unitId && !unitId) throw new ValidationError('DEAL_UNIT_REQUIRED', 'DEAL_UNIT_REQUIRED: для показа укажите юнит');
  if (unitId && unitId !== deal.unitId) await updateDeal(ctx, dealId, { unitId });
  await addDealActivity(ctx, dealId, { kind: 'VIEWING', note: input.note?.trim() || `Показ ${input.at.toISOString().slice(0, 16).replace('T', ' ')}`, followUpAt: input.at });
  const order = ['NEW', 'QUALIFIED', 'PROPERTY_SELECTED', 'VIEWING'];
  let stage = deal.stage as string;
  while (order.indexOf(stage) >= 0 && order.indexOf(stage) < 3) { await moveDeal(ctx, dealId, 'advance', {}, now); stage = order[order.indexOf(stage) + 1]!; }
  await updateDeal(ctx, dealId, { nextAction: 'Провести показ', nextActionAt: input.at });
}

export type ViewingResult = 'OFFER' | 'THINKING' | 'RESCHEDULE' | 'LOST';
/** Результат показа (BR-P60): оффер → стадия OFFER; думает → follow-up; перенос → новый показ; отказ → LOST c причиной. */
export async function viewingResult(ctx: TenantContext, dealId: string, input: { result: ViewingResult; note?: string | null; expectedRateMinor?: bigint | null; followUpAt?: Date | null; lostReason?: DealLostReason | null }, now = new Date()) {
  const deal = await prisma.deal.findFirst({ where: { tenantId: ctx.tenantId, id: dealId } });
  if (!deal) throw new ValidationError('NOT_FOUND');
  const note = input.note?.trim() || '';
  if (input.result === 'OFFER') {
    await addDealActivity(ctx, dealId, { kind: 'OFFER', note: note || 'Показ прошёл, готовим оффер', expectedRateMinor: input.expectedRateMinor ?? null });
    if (deal.stage === 'VIEWING') await moveDeal(ctx, dealId, 'advance', {}, now);
    await updateDeal(ctx, dealId, { nextAction: 'Отправить оффер', nextActionAt: input.followUpAt ?? new Date(now.getTime() + 86_400_000), ...(input.expectedRateMinor != null ? { expectedRateMinor: input.expectedRateMinor } : {}) });
  } else if (input.result === 'THINKING') {
    const at = input.followUpAt ?? new Date(now.getTime() + 2 * 86_400_000);
    await addDealActivity(ctx, dealId, { kind: 'FOLLOW_UP', note: note || 'Показ прошёл, клиент думает', followUpAt: at });
    await updateDeal(ctx, dealId, { nextAction: 'Перезвонить после показа', nextActionAt: at });
  } else if (input.result === 'RESCHEDULE') {
    if (!input.followUpAt) throw new ValidationError('DATE_REQUIRED');
    await scheduleViewing(ctx, dealId, { at: input.followUpAt, note: note || 'Перенос показа' }, now);
  } else {
    if (!input.lostReason) throw new ValidationError('LOST_REASON_REQUIRED');
    await addDealActivity(ctx, dealId, { kind: 'NOTE', note: note || 'Показ прошёл, отказ' });
    await moveDeal(ctx, dealId, 'lose', { lostReason: input.lostReason, ...(note ? { lostNote: note } : {}) }, now);
  }
}

/** Быстрый лид c телефона: имя, телефон, потребность → сделка NEW co следующим шагом «связаться». */
export async function quickLead(ctx: TenantContext, input: { contactName: string; contactPhone?: string | null; note?: string | null; unitNo?: string | null; source?: 'WEBSITE' | 'TELEGRAM' | 'INSTAGRAM' | 'REFERRAL' | 'BROKER' | 'WALK_IN' | 'OTHER'; managerId?: string | null }, now = new Date()) {
  const unit = input.unitNo ? await prisma.unit.findFirst({ where: { tenantId: ctx.tenantId, unitNo: { equals: input.unitNo.trim(), mode: 'insensitive' } }, select: { id: true, askingRateMinor: true } }) : null;
  const deal = await createDeal(ctx, { contactName: input.contactName, contactPhone: input.contactPhone ?? null, source: input.source ?? 'WALK_IN', purpose: input.note ?? null, unitId: unit?.id ?? null, expectedRateMinor: unit?.askingRateMinor ?? null, nextAction: 'Связаться c клиентом', nextActionAt: new Date(now.getTime() + 15 * 60_000), ...(input.managerId ? { managerId: input.managerId } : {}) });
  if (input.note?.trim()) await addDealActivity(ctx, deal.id, { kind: 'NOTE', note: input.note.trim() });
  return deal;
}

export async function ownerQuickCall(ctx: TenantContext, ownerId: string, input: { note: string; followUpAt?: Date | null }) {
  return addOwnerActivity(ctx, ownerId, { kind: 'CALL', note: input.note, followUpAt: input.followUpAt ?? null });
}

export async function taskDone(ctx: TenantContext, taskId: string) { return setTaskStatus(ctx, taskId, 'DONE'); }
