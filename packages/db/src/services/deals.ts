/**
 * Wave 2: сделки CRM (docs/20 §11.2, ADR-018). Воронка blueprint §6; commercialStatus юнита — производное (BR-P20);
 * брокер видит и ведёт только свои сделки (BR-P21); WON — только через активацию договора (BR-P23, leases.ts).
 */
import type { DealProduct, DealStage, DealTrigger, TenantCategory, TenantContext } from '@finance-os/core';
import {
  NotFoundError,
  STAGE_PROBABILITY,
  ValidationError,
  can,
  commercialStatusFromDeals,
  dealAttention,
  dealMachine,
  hasRole,
  isActiveStage,
  nextStage,
  pipelineTotals,
  prevStage,
  requirePermission,
  type DealAttention,
  normalizeEmail,
  normalizePhone,
} from '@finance-os/core';
import type { Deal, DealLostReason, DealSource, Prisma, UnitActivityKind } from '@prisma/client';
import { Prisma as P } from '@prisma/client';
import { withAudit } from '../audit.js';
import { resolveContact } from './contacts.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { nextNumber } from '../sequence.js';
import { emitDomainEvent } from './domainEvents.js';

export interface DealInput {
  contactName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  company?: string | null;
  source?: DealSource;
  utm?: Record<string, string> | null;
  budgetMinor?: bigint | null;
  areaMinM2?: number | null;
  areaMaxM2?: number | null;
  purpose?: string | null;
  timing?: string | null;
  unitId?: string | null;
  managerId?: string;
  nextAction?: string | null;
  nextActionAt?: Date | null;
  expectedRateMinor?: bigint | null;
  reservedUntil?: Date | null;
  depositReceived?: boolean;
  /** P-14: продукт сделки (BR-P41); по умолчанию LEASE_LTR, для офисов — LEASE_OFFICE. */
  product?: DealProduct;
  salePriceMinor?: bigint | null;
  commissionRateBp?: number | null;
  externalBrokerName?: string | null;
  externalShareBp?: number;
  tenantCategory?: TenantCategory | null;
  /** Переопределение createdAt (логическое now из быстрых действий); по умолчанию — now() БД. */
  createdAt?: Date;
}

const brokerOnly = (ctx: TenantContext) => hasRole(ctx, 'BROKER') && !hasRole(ctx, 'OWNER', 'COMMERCIAL_MANAGER');
/** BR-P62: колл-центр без роли менеджера/владельца/брокера. */
const callCenterOnly = (ctx: TenantContext) => hasRole(ctx, 'CALL_CENTER') && !hasRole(ctx, 'OWNER', 'COMMERCIAL_MANAGER', 'BROKER');
/** Дежурный менеджер для лидов КЦ: tenant.settings.lead_default_manager или первый COMMERCIAL_MANAGER. */
async function defaultManager(tenantId: string): Promise<string | null> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const s = (t?.settings ?? {}) as Record<string, unknown>;
  if (typeof s.lead_default_manager === 'string') return s.lead_default_manager;
  return (await prisma.userTenantRole.findFirst({ where: { tenantId, role: 'COMMERCIAL_MANAGER' }, orderBy: { createdAt: 'asc' }, select: { userId: true } }))?.userId ?? null;
}
const pick = (d: Deal) => ({ stage: d.stage, product: d.product, unitId: d.unitId, managerId: d.managerId, expectedRateMinor: d.expectedRateMinor?.toString() ?? null, reservedUntil: d.reservedUntil, nextActionAt: d.nextActionAt, depositReceived: d.depositReceived });

const validShare = (bp?: number): number => { if (bp == null) return 0; if (!Number.isInteger(bp) || bp < 0 || bp > 10_000) throw new ValidationError('SHARE_INVALID', 'SHARE_INVALID: доля внешнего брокера 0–100%'); return bp; };

/** BR-P21: брокер работает только со своими сделками. */
async function loadOwnDeal(tx: Prisma.TransactionClient, ctx: TenantContext, id: string): Promise<Deal> {
  const deal = await findScopedOr404(tx.deal, ctx, id);
  if (brokerOnly(ctx) && deal.managerId !== ctx.userId) throw new NotFoundError();
  return deal;
}

/** BR-P20: пересчёт commercialStatus юнита по активным сделкам. Занятые юниты не трогаем. */
export async function recomputeUnitCommercialStatus(tx: Prisma.TransactionClient, tenantId: string, unitId: string, today = new Date()): Promise<void> {
  const unit = await tx.unit.findFirst({ where: { id: unitId, tenantId } });
  if (!unit || unit.occupancy !== 'VACANT') return;
  const deals = await tx.deal.findMany({ where: { tenantId, unitId }, select: { stage: true, reservedUntil: true } });
  const next = commercialStatusFromDeals(deals, unit.commercialStatus, today);
  if (next !== unit.commercialStatus) {
    await tx.unit.update({ where: { id: unitId }, data: { commercialStatus: next, statusEffectiveAt: today, ...(next === 'CONTRACTED' || next === 'LOI' ? { publishedAt: null } : {}) } });
    await emitDomainEvent(tx, tenantId, 'unit.status.changed', 'unit', unitId, { unitNo: unit.unitNo, commercialStatus: next, detail: 'from deals', deepLink: `/property/units/${unitId}` });
  }
}

export async function createDeal(ctx: TenantContext, input: DealInput): Promise<Deal> {
  requirePermission(ctx, 'deal.manage');
  if (!input.contactName.trim()) throw new ValidationError('CONTACT_REQUIRED');
  const managerId = brokerOnly(ctx) ? ctx.userId : (input.managerId ?? (callCenterOnly(ctx) ? (await defaultManager(ctx.tenantId)) ?? ctx.userId : ctx.userId));
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    if (input.unitId) await findScopedOr404(tx.unit, ctx, input.unitId);
    const number = await nextNumber(tx, ctx.tenantId, 'DEAL');
    // P-22a: сделка привязана к контакту (BR-P55) — телефон канонический, повторный клиент не дублируется
    const contact = await resolveContact(tx, ctx.tenantId, { name: input.contactName, phone: input.contactPhone, email: input.contactEmail, company: input.company, source: input.source ?? 'OTHER', managerId, actorId: ctx.userId });
    const created = await tx.deal.create({
      data: {
        tenantId: ctx.tenantId, number, contactName: input.contactName.trim(), contactPhone: normalizePhone(input.contactPhone), contactEmail: normalizeEmail(input.contactEmail), contactId: contact.id,
        company: input.company ?? null, source: input.source ?? 'OTHER', utm: input.utm ? (input.utm as P.InputJsonValue) : P.DbNull,
        budgetMinor: input.budgetMinor ?? null, areaMinM2: input.areaMinM2 != null ? new P.Decimal(input.areaMinM2) : null, areaMaxM2: input.areaMaxM2 != null ? new P.Decimal(input.areaMaxM2) : null,
        purpose: input.purpose ?? null, timing: input.timing ?? null, unitId: input.unitId ?? null, managerId,
        stage: input.unitId ? 'PROPERTY_SELECTED' : 'NEW', nextAction: input.nextAction ?? null, nextActionAt: input.nextActionAt ?? null,
        expectedRateMinor: input.expectedRateMinor ?? null, reservedUntil: input.reservedUntil ?? null, depositReceived: input.depositReceived ?? false, createdBy: ctx.userId,
        product: input.product ?? 'LEASE_LTR', salePriceMinor: input.salePriceMinor ?? null, commissionRateBp: input.commissionRateBp ?? null, externalBrokerName: input.externalBrokerName ?? null, externalShareBp: validShare(input.externalShareBp), tenantCategory: input.tenantCategory ?? null,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
    });
    if (created.unitId) await recomputeUnitCommercialStatus(tx, ctx.tenantId, created.unitId);
    // контакты (PII) в audit не пишем
    return { result: created, audit: { action: 'deal.create', objectType: 'deal', objectId: created.id, after: { number, source: created.source, ...pick(created) } } };
  });
}

export async function updateDeal(ctx: TenantContext, id: string, patch: Partial<DealInput>): Promise<Deal> {
  requirePermission(ctx, 'deal.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await loadOwnDeal(tx, ctx, id);
    if (!isActiveStage(before.stage) && Object.keys(patch).some((k) => k !== 'nextAction' && k !== 'nextActionAt')) throw new ValidationError('DEAL_CLOSED', 'DEAL_CLOSED: закрытую сделку нельзя менять — reopen');
    if (patch.unitId) await findScopedOr404(tx.unit, ctx, patch.unitId);
    if (patch.managerId !== undefined && brokerOnly(ctx)) throw new ValidationError('BROKER_CANNOT_REASSIGN');
    const after = await tx.deal.update({
      where: { id },
      data: {
        ...(patch.contactName !== undefined ? { contactName: patch.contactName.trim() } : {}),
        ...(patch.contactPhone !== undefined ? { contactPhone: patch.contactPhone } : {}),
        ...(patch.contactEmail !== undefined ? { contactEmail: patch.contactEmail } : {}),
        ...(patch.company !== undefined ? { company: patch.company } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.budgetMinor !== undefined ? { budgetMinor: patch.budgetMinor } : {}),
        ...(patch.areaMinM2 !== undefined ? { areaMinM2: patch.areaMinM2 != null ? new P.Decimal(patch.areaMinM2) : null } : {}),
        ...(patch.areaMaxM2 !== undefined ? { areaMaxM2: patch.areaMaxM2 != null ? new P.Decimal(patch.areaMaxM2) : null } : {}),
        ...(patch.purpose !== undefined ? { purpose: patch.purpose } : {}),
        ...(patch.timing !== undefined ? { timing: patch.timing } : {}),
        ...(patch.unitId !== undefined ? { unitId: patch.unitId } : {}),
        ...(patch.managerId !== undefined ? { managerId: patch.managerId } : {}),
        ...(patch.nextAction !== undefined ? { nextAction: patch.nextAction } : {}),
        ...(patch.nextActionAt !== undefined ? { nextActionAt: patch.nextActionAt } : {}),
        ...(patch.expectedRateMinor !== undefined ? { expectedRateMinor: patch.expectedRateMinor } : {}),
        ...(patch.reservedUntil !== undefined ? { reservedUntil: patch.reservedUntil } : {}),
        ...(patch.depositReceived !== undefined ? { depositReceived: patch.depositReceived } : {}),
        ...(patch.product !== undefined ? { product: patch.product } : {}),
        ...(patch.salePriceMinor !== undefined ? { salePriceMinor: patch.salePriceMinor } : {}),
        ...(patch.commissionRateBp !== undefined ? { commissionRateBp: patch.commissionRateBp } : {}),
        ...(patch.externalBrokerName !== undefined ? { externalBrokerName: patch.externalBrokerName } : {}),
        ...(patch.externalShareBp !== undefined ? { externalShareBp: validShare(patch.externalShareBp) } : {}),
        ...(patch.tenantCategory !== undefined ? { tenantCategory: patch.tenantCategory } : {}),
        updatedBy: ctx.userId,
      },
    });
    for (const unitId of new Set([before.unitId, after.unitId].filter((x): x is string => !!x))) await recomputeUnitCommercialStatus(tx, ctx.tenantId, unitId);
    return { result: after, audit: { action: 'deal.update', objectType: 'deal', objectId: id, before: pick(before), after: pick(after) } };
  });
}

/** Переход по воронке: advance/back — на одну стадию; lose — c причиной; reopen; win — только через leases.activateLease. */
export async function moveDeal(ctx: TenantContext, id: string, trigger: Exclude<DealTrigger, 'win'>, input: { lostReason?: DealLostReason; lostNote?: string } = {}, now = new Date()): Promise<Deal> {
  requirePermission(ctx, 'deal.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await loadOwnDeal(tx, ctx, id);
    dealMachine.assert(ctx, before.stage, trigger, { brokerOnly: brokerOnly(ctx), callCenterOnly: callCenterOnly(ctx), hasUnit: !!before.unitId });
    let stage: DealStage;
    if (trigger === 'advance') stage = nextStage(before.stage)!;
    else if (trigger === 'back') stage = prevStage(before.stage)!;
    else if (trigger === 'lose') {
      if (!input.lostReason) throw new ValidationError('LOST_REASON_REQUIRED', 'LOST_REASON_REQUIRED: укажите структурированную причину проигрыша');
      stage = 'LOST';
    } else stage = 'NEW';
    const after = await tx.deal.update({
      where: { id },
      data: { stage, stageChangedAt: now, updatedBy: ctx.userId, ...(stage === 'LOST' ? { lostReason: input.lostReason, lostNote: input.lostNote ?? null, reservedUntil: null } : {}), ...(trigger === 'reopen' ? { lostReason: null, lostNote: null } : {}) },
    });
    if (after.unitId) await recomputeUnitCommercialStatus(tx, ctx.tenantId, after.unitId, now);
    await emitDomainEvent(tx, ctx.tenantId, 'deal.stage.changed', 'deal', id, { number: after.number, stage, detail: trigger, deepLink: `/deals/${id}` });
    return { result: after, audit: { action: 'deal.stage.change', objectType: 'deal', objectId: id, before: { stage: before.stage }, after: { stage, trigger, lostReason: after.lostReason ?? null } } };
  });
}

export interface DealRow {
  id: string;
  number: string;
  stage: DealStage;
  probability: number;
  contactName: string;
  contactPhone: string | null;
  company: string | null;
  source: DealSource;
  unitId: string | null;
  unitNo: string | null;
  buildingName: string | null;
  managerId: string;
  managerName: string;
  nextAction: string | null;
  nextActionAt: Date | null;
  expectedRateMinor: bigint | null;
  budgetMinor: bigint | null;
  reservedUntil: Date | null;
  depositReceived: boolean;
  stageChangedAt: Date;
  lostReason: DealLostReason | null;
  attention: DealAttention[];
  createdAt: Date;
}

export interface DealFilter {
  stage?: DealStage;
  managerId?: string;
  unitId?: string;
  attentionOnly?: boolean;
  includeClosed?: boolean;
  q?: string;
}

/** BR-P13/P21: контакты — по deal.contact.view; брокер видит только свои. */
export async function listDeals(ctx: TenantContext, filter: DealFilter = {}, today = new Date()): Promise<DealRow[]> {
  requirePermission(ctx, 'deal.view');
  const showContact = can(ctx, 'deal.contact.view');
  const where: Prisma.DealWhereInput = { tenantId: ctx.tenantId };
  if (brokerOnly(ctx)) where.managerId = ctx.userId;
  else if (filter.managerId) where.managerId = filter.managerId;
  if (filter.stage) where.stage = filter.stage;
  else if (!filter.includeClosed) where.stage = { notIn: ['WON', 'LOST'] };
  if (filter.unitId) where.unitId = filter.unitId;
  const rows = await prisma.deal.findMany({
    where,
    include: { unit: { select: { unitNo: true, building: { select: { name: true } } } } },
    orderBy: [{ stageChangedAt: 'desc' }],
  });
  const managers = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.managerId))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const q = filter.q?.trim().toLowerCase();
  const out: DealRow[] = [];
  for (const d of rows) {
    if (q && ![d.number, d.contactName, d.company ?? '', d.unit?.unitNo ?? ''].join('\u0000').toLowerCase().includes(q)) continue;
    const attention = dealAttention(d, today);
    if (filter.attentionOnly && attention.length === 0) continue;
    out.push({
      id: d.id, number: d.number, stage: d.stage, probability: STAGE_PROBABILITY[d.stage], contactName: showContact ? d.contactName : maskContact(d.contactName),
      contactPhone: showContact ? d.contactPhone : null, company: d.company, source: d.source, unitId: d.unitId, unitNo: d.unit?.unitNo ?? null, buildingName: d.unit?.building.name ?? null,
      managerId: d.managerId, managerName: managers.get(d.managerId) ?? '—', nextAction: d.nextAction, nextActionAt: d.nextActionAt, expectedRateMinor: d.expectedRateMinor, budgetMinor: d.budgetMinor,
      reservedUntil: d.reservedUntil, depositReceived: d.depositReceived, stageChangedAt: d.stageChangedAt, lostReason: d.lostReason, attention, createdAt: d.createdAt,
    });
  }
  return out;
}

export function maskContact(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.map((p, i) => (i === 0 ? p : `${p[0] ?? ''}.`)).join(' ');
}

export interface PipelineSummary {
  byStage: { stage: DealStage; count: number; potentialMinor: bigint }[];
  totals: ReturnType<typeof pipelineTotals>;
  attention: number;
  lostThisMonth: number;
  lostPotentialMinor: bigint;
}

/** Сводка воронки для доски и CEO-контура (docs/16 §9). */
export async function getPipelineSummary(ctx: TenantContext, today = new Date()): Promise<PipelineSummary> {
  requirePermission(ctx, 'deal.view');
  const rows = await prisma.deal.findMany({ where: whereTenant(ctx, brokerOnly(ctx) ? { managerId: ctx.userId } : {}), select: { stage: true, expectedRateMinor: true, budgetMinor: true, depositReceived: true, nextAction: true, nextActionAt: true, stageChangedAt: true, reservedUntil: true } });
  const byStage = new Map<DealStage, { count: number; potentialMinor: bigint }>();
  let attention = 0;
  let lostThisMonth = 0;
  let lostPotentialMinor = 0n;
  const month = today.toISOString().slice(0, 7);
  for (const d of rows) {
    const s = byStage.get(d.stage) ?? { count: 0, potentialMinor: 0n };
    s.count++;
    s.potentialMinor += d.expectedRateMinor ?? d.budgetMinor ?? 0n;
    byStage.set(d.stage, s);
    if (dealAttention(d, today).length) attention++;
    if (d.stage === 'LOST' && d.stageChangedAt.toISOString().slice(0, 7) === month) {
      lostThisMonth++;
      lostPotentialMinor += d.expectedRateMinor ?? d.budgetMinor ?? 0n;
    }
  }
  return {
    byStage: [...byStage.entries()].map(([stage, v]) => ({ stage, ...v })),
    totals: pipelineTotals(rows),
    attention,
    lostThisMonth,
    lostPotentialMinor,
  };
}

export async function getDeal(ctx: TenantContext, id: string, today = new Date()) {
  requirePermission(ctx, 'deal.view');
  const d = await prisma.deal.findFirst({ where: whereTenant(ctx, { id }), include: { unit: { select: { id: true, unitNo: true, areaM2: true, askingRateMinor: true, askingCurrency: true, building: { select: { name: true } }, floor: { select: { floorNo: true } } } }, activities: { orderBy: { happenedAt: 'desc' }, take: 50 } } });
  if (!d || (brokerOnly(ctx) && d.managerId !== ctx.userId)) throw new NotFoundError();
  const showContact = can(ctx, 'deal.contact.view');
  const manager = await prisma.user.findUnique({ where: { id: d.managerId }, select: { fullName: true } });
  const lease = d.wonLeaseId ? await prisma.leaseContract.findFirst({ where: { id: d.wonLeaseId, tenantId: ctx.tenantId }, select: { id: true, status: true } }) : null;
  const audit = can(ctx, 'audit.view') || can(ctx, 'deal.manage') ? await prisma.auditLog.findMany({ where: { tenantId: ctx.tenantId, objectType: 'deal', objectId: id }, orderBy: { seq: 'desc' }, take: 30, select: { id: true, action: true, at: true, before: true, after: true } }) : [];
  const payload = { brokerOnly: brokerOnly(ctx), hasUnit: !!d.unitId, hasLease: !!lease };
  return {
    deal: { ...d, contactName: showContact ? d.contactName : maskContact(d.contactName), contactPhone: showContact ? d.contactPhone : null, contactEmail: showContact ? d.contactEmail : null, areaMinM2: d.areaMinM2 ? Number(d.areaMinM2) : null, areaMaxM2: d.areaMaxM2 ? Number(d.areaMaxM2) : null, unit: d.unit ? { ...d.unit, areaM2: Number(d.unit.areaM2) } : null },
    managerName: manager?.fullName ?? '—',
    probability: STAGE_PROBABILITY[d.stage],
    attention: dealAttention(d, today),
    nextStage: nextStage(d.stage),
    prevStage: prevStage(d.stage),
    can: {
      advance: dealMachine.can(ctx, d.stage, 'advance', payload),
      back: dealMachine.can(ctx, d.stage, 'back', payload),
      lose: dealMachine.can(ctx, d.stage, 'lose', payload),
      reopen: dealMachine.can(ctx, d.stage, 'reopen', payload),
      edit: can(ctx, 'deal.manage') && (!brokerOnly(ctx) || d.managerId === ctx.userId),
      lease: can(ctx, 'lease.manage') && isActiveStage(d.stage) && !!d.unitId && !['SALE', 'PARKING_SALE'].includes(d.product),
      closeSale: can(ctx, 'deal.manage') && !brokerOnly(ctx) && ['SALE', 'PARKING_SALE'].includes(d.product) && (d.stage === 'CONTRACT' || d.stage === 'MOVE_IN'),
    },
    lease,
    audit,
  };
}

export async function addDealActivity(ctx: TenantContext, dealId: string, input: { kind: UnitActivityKind; note: string; expectedRateMinor?: bigint | null; followUpAt?: Date | null; happenedAt?: Date | null }) {
  requirePermission(ctx, 'deal.manage');
  if (!input.note.trim()) throw new ValidationError('NOTE_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const deal = await loadOwnDeal(tx, ctx, dealId);
    const created = await tx.unitActivity.create({
      // happenedAt по умолчанию — now() БД; передаётся из быстрых действий, чтобы «сегодня» в «Моём дне»
      // считалось относительно логического now (детерминированно в тестах, без изменения прод-поведения)
      data: { tenantId: ctx.tenantId, dealId, unitId: deal.unitId, kind: input.kind, note: input.note.trim(), expectedRateMinor: input.expectedRateMinor ?? null, followUpAt: input.followUpAt ?? null, actorId: ctx.userId, ...(input.happenedAt ? { happenedAt: input.happenedAt } : {}) },
    });
    // follow-up активности становится следующим действием сделки (BR-P22)
    if (input.followUpAt) await tx.deal.update({ where: { id: dealId }, data: { nextAction: input.note.trim().slice(0, 120), nextActionAt: input.followUpAt, ...(input.expectedRateMinor != null ? { expectedRateMinor: input.expectedRateMinor } : {}) } });
    return { result: created, audit: { action: 'deal.activity.create', objectType: 'deal', objectId: dealId, after: { activityId: created.id, kind: created.kind } } };
  });
}

/** Джоб deal-followup: просроченное следующее действие → Task DEAL_FOLLOWUP менеджеру (дедуп). */
export async function createDealFollowupTasks(tenantId: string, now = new Date()): Promise<number> {
  const overdue = await prisma.deal.findMany({ where: { tenantId, stage: { notIn: ['WON', 'LOST'] }, nextActionAt: { not: null, lt: now } } });
  let created = 0;
  for (const d of overdue) {
    const exists = await prisma.task.count({ where: { tenantId, type: 'DEAL_FOLLOWUP', objectId: d.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
    if (exists) continue;
    await prisma.task.create({ data: { tenantId, type: 'DEAL_FOLLOWUP', objectType: 'deal', objectId: d.id, ownerId: d.managerId, dueAt: d.nextActionAt, nextAction: `Сделка ${d.number}: просрочено «${d.nextAction ?? 'следующее действие'}» — связаться c клиентом и обновить стадию` } });
    created++;
  }
  return created;
}

/** Менеджеры для назначения сделки: OWNER/COMMERCIAL_MANAGER/BROKER тенанта (без user.manage). */
export async function listDealManagers(ctx: TenantContext): Promise<{ id: string; fullName: string; roles: string[] }[]> {
  requirePermission(ctx, 'deal.view');
  const rows = await prisma.userTenantRole.findMany({ where: { tenantId: ctx.tenantId, role: { in: ['OWNER', 'COMMERCIAL_MANAGER', 'BROKER'] }, user: { status: 'ACTIVE' } }, include: { user: { select: { id: true, fullName: true } } }, orderBy: { user: { fullName: 'asc' } } });
  const by = new Map<string, { id: string; fullName: string; roles: string[] }>();
  for (const r of rows) {
    const e = by.get(r.userId) ?? { id: r.userId, fullName: r.user.fullName, roles: [] };
    e.roles.push(r.role);
    by.set(r.userId, e);
  }
  return [...by.values()];
}
