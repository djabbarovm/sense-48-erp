/**
 * Начисление аренды и дебиторка (docs/20 §11.9; blueprint §1.7 Finance, §1.8, §9 Finance).
 * BR-P37: PAID только через зачёт банковской транзакции (ReconciliationMatch RENT_CHARGE) — кнопки «оплачено» нет.
 * BR-P38: начисление по месяцам c пропорцией по дням; повторный запуск идемпотентен (unique leaseId+periodStart).
 * BR-P39: прекращение договора списывает (WAIVED) начисления будущих периодов.
 */
import type { RentChargeStatus, TenantContext } from '@finance-os/core';
import { DEFAULT_RENT_GRACE_DAYS, NotFoundError, OPEN_RENT_STATUSES, ValidationError, can, outstandingOf, rentChargeStatus, rentDueAt, rentPeriods, requirePermission, validateReceipt } from '@finance-os/core';
import type { Prisma, RentCharge } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404 } from '../repository.js';
import { nextNumber } from '../sequence.js';
import { emitDomainEvent } from './domainEvents.js';

const pick = (c: RentCharge) => ({ status: c.status, amountMinor: c.amountMinor, receivedMinor: c.receivedMinor, dueAt: c.dueAt, periodStart: c.periodStart, leaseId: c.leaseId, unitId: c.unitId });

async function graceDays(tenantId: string): Promise<number> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const v = Number((t?.settings as Record<string, unknown> | null)?.rent_grace_days ?? DEFAULT_RENT_GRACE_DAYS);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_RENT_GRACE_DAYS;
}

/**
 * Джоб rent-charges: начислить месяцы до текущего включительно по действующим договорам (не OWNER_USE, rent > 0)
 * ТОЛЬКО для юнитов под управлением (BR-P40): при брокеридже (LTR/офисы, бизнес-модель Tower §2.1) аренда идёт
 * собственнику напрямую, ORDO её не собирает и дебиторку не ведёт. `fromMonth` — не начислять периоды раньше (seed/миграция).
 */
export async function generateRentCharges(tenantId: string, now = new Date(), opts: { fromMonth?: Date } = {}): Promise<number> {
  const grace = await graceDays(tenantId);
  const leases = await prisma.leaseContract.findMany({ where: { tenantId, status: { in: ['ACTIVE', 'EXPIRING'] }, type: { not: 'OWNER_USE' }, rentMinor: { gt: 0n }, unit: { managedByPlatform: true } }, include: { unit: { select: { ownerId: true, unitNo: true } } } });
  let n = 0;
  for (const l of leases) {
    const existing = new Set((await prisma.rentCharge.findMany({ where: { leaseId: l.id }, select: { periodStart: true } })).map((c) => c.periodStart.toISOString().slice(0, 10)));
    for (const p of rentPeriods(l.rentMinor, l.startAt, l.endAt, now)) {
      if (opts.fromMonth && p.periodStart < opts.fromMonth) continue;
      const key = p.periodStart.toISOString().slice(0, 10);
      if (existing.has(key)) continue;
      await withAudit({ tenantId }, async (tx) => {
        const number = await nextNumber(tx, tenantId, 'RC', now);
        const created = await tx.rentCharge.create({ data: { tenantId, number, leaseId: l.id, unitId: l.unitId, ownerId: l.unit.ownerId, periodStart: p.periodStart, periodEnd: p.periodEnd, dueAt: rentDueAt(p.periodStart, grace), amountMinor: p.amountMinor, currency: l.currency, prorated: p.prorated } });
        return { result: created, audit: { action: 'rent_charge.create', objectType: 'rent_charge', objectId: created.id, after: { number, ...pick(created), unitNo: l.unit.unitNo, prorated: p.prorated } } };
      });
      n++;
    }
  }
  return n;
}

/** Джоб rent-overdue: просроченные DUE/PARTIAL → OVERDUE + Task RENT_OVERDUE (дедуп) + событие; юнит помечается должником в выборках. */
export async function markOverdueRentCharges(tenantId: string, now = new Date()): Promise<number> {
  const rows = await prisma.rentCharge.findMany({ where: { tenantId, status: { in: ['DUE', 'PARTIAL', 'OVERDUE'] }, dueAt: { lt: now }, overdueNotifiedAt: null }, include: { unit: { select: { unitNo: true } }, lease: { select: { occupantName: true } } } });
  let n = 0;
  for (const c of rows) {
    if (rentChargeStatus(c, now) !== 'OVERDUE') continue;
    await withAudit({ tenantId }, async (tx) => {
      const finance = (await tx.userTenantRole.findFirst({ where: { tenantId, role: { in: ['FINANCE_OPS_LEAD', 'COMMERCIAL_MANAGER'] } }, orderBy: { role: 'asc' }, select: { userId: true } }))?.userId ?? null;
      const exists = await tx.task.count({ where: { tenantId, type: 'RENT_OVERDUE', objectId: c.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
      if (!exists) await tx.task.create({ data: { tenantId, type: 'RENT_OVERDUE', objectType: 'rent_charge', objectId: c.id, ownerId: finance, dueAt: c.dueAt, nextAction: `Аренда ${c.unit.unitNo} за ${c.periodStart.toISOString().slice(0, 7)} просрочена (${c.number}): напомнить арендатору, сверить поступления` } });
      const after = await tx.rentCharge.update({ where: { id: c.id }, data: { status: 'OVERDUE', overdueNotifiedAt: now } });
      await emitDomainEvent(tx, tenantId, 'rent.overdue', 'rent_charge', c.id, { number: c.number, unitNo: c.unit.unitNo, period: c.periodStart.toISOString().slice(0, 7), detail: `${c.lease.occupantName}: остаток ${outstandingOf(after)}`, deepLink: `/rent?view=overdue` });
      return { result: after, audit: { action: 'rent_charge.overdue', objectType: 'rent_charge', objectId: c.id, before: pick(c), after: pick(after) } };
    });
    n++;
  }
  return n;
}

/** BR-P39: при прекращении договора начисления будущих периодов списываются; текущий период остаётся к оплате. */
export async function waiveFutureRentCharges(tx: Prisma.TransactionClient, tenantId: string, leaseId: string, at: Date, reason: string): Promise<number> {
  const future = await tx.rentCharge.findMany({ where: { tenantId, leaseId, status: { in: ['DUE', 'PARTIAL', 'OVERDUE'] }, periodStart: { gt: at }, receivedMinor: 0n } });
  for (const c of future) await tx.rentCharge.update({ where: { id: c.id }, data: { status: 'WAIVED', waivedReason: reason } });
  return future.length;
}

/** Зачёт входящей банковской транзакции в начисление (BR-P37). Сумма — в валюте начисления; по умолчанию = сумме транзакции при совпадении валют. */
export async function matchRentReceipt(ctx: TenantContext, input: { bankTransactionId: string; rentChargeId: string; amountMinor?: bigint | null }, now = new Date()): Promise<RentCharge> {
  requirePermission(ctx, 'rent.match');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const charge = await findScopedOr404(tx.rentCharge, ctx, input.rentChargeId);
    const bankTx = await findScopedOr404(tx.bankTransaction, ctx, input.bankTransactionId);
    if (bankTx.amountMinor <= 0n) throw new ValidationError('TX_NOT_INCOMING', 'TX_NOT_INCOMING: зачесть можно только поступление');
    if (bankTx.matchStatus === 'IGNORED') throw new ValidationError('TX_IGNORED');
    if (!OPEN_RENT_STATUSES.includes(charge.status)) throw new ValidationError('CHARGE_NOT_OPEN', 'CHARGE_NOT_OPEN: начисление уже закрыто');
    const already = (await tx.reconciliationMatch.aggregate({ where: { bankTransactionId: bankTx.id }, _sum: { amountMinor: true } }))._sum.amountMinor ?? 0n;
    const sameCurrency = bankTx.currency === charge.currency;
    let amount = input.amountMinor ?? (sameCurrency ? bankTx.amountMinor - already : null);
    if (amount == null) throw new ValidationError('AMOUNT_REQUIRED', 'AMOUNT_REQUIRED: валюты различаются — укажите сумму зачёта в валюте начисления');
    amount = validateReceipt(amount, outstandingOf(charge));
    if (sameCurrency && amount > bankTx.amountMinor - already) throw new ValidationError('TX_EXHAUSTED', 'TX_EXHAUSTED: транзакция уже распределена');
    await tx.reconciliationMatch.create({ data: { tenantId: ctx.tenantId, bankTransactionId: bankTx.id, objectType: 'RENT_CHARGE', objectId: charge.id, amountMinor: amount, matchedBy: ctx.userId, method: 'MANUAL', confidence: 1 } });
    await tx.bankTransaction.update({ where: { id: bankTx.id }, data: { matchStatus: 'MANUAL_MATCHED' } });
    const received = charge.receivedMinor + amount;
    const status = rentChargeStatus({ amountMinor: charge.amountMinor, receivedMinor: received, dueAt: charge.dueAt }, now);
    const after = await tx.rentCharge.update({ where: { id: charge.id }, data: { receivedMinor: received, status, paidAt: status === 'PAID' ? now : null } });
    if (status === 'PAID') {
      const unit = await tx.unit.findUnique({ where: { id: charge.unitId }, select: { unitNo: true } });
      await emitDomainEvent(tx, ctx.tenantId, 'rent.paid', 'rent_charge', charge.id, { number: charge.number, unitNo: unit?.unitNo ?? null, period: charge.periodStart.toISOString().slice(0, 7), deepLink: `/property/units/${charge.unitId}` });
    }
    return { result: after, audit: { action: 'rent_charge.receipt', objectType: 'rent_charge', objectId: charge.id, before: pick(charge), after: { ...pick(after), bankTransactionId: bankTx.id, amountMinor: amount } } };
  });
}

export interface RentChargeRow extends RentCharge {
  unitNo: string;
  occupantName: string;
  outstandingMinor: bigint;
  daysOverdue: number;
}

export async function listRentCharges(ctx: TenantContext, filter: { status?: RentChargeStatus[]; unitId?: string; leaseId?: string; ownerId?: string; periodFrom?: Date; periodTo?: Date; take?: number; skip?: number } = {}, now = new Date()): Promise<RentChargeRow[]> {
  if (!filter.ownerId) requirePermission(ctx, 'rent.view');
  const where: Prisma.RentChargeWhereInput = { tenantId: ctx.tenantId };
  if (filter.status) where.status = { in: filter.status };
  if (filter.unitId) where.unitId = filter.unitId;
  if (filter.leaseId) where.leaseId = filter.leaseId;
  if (filter.ownerId) where.ownerId = filter.ownerId;
  if (filter.periodFrom || filter.periodTo) where.periodStart = { ...(filter.periodFrom ? { gte: filter.periodFrom } : {}), ...(filter.periodTo ? { lte: filter.periodTo } : {}) };
  const rows = await prisma.rentCharge.findMany({ where, include: { unit: { select: { unitNo: true } }, lease: { select: { occupantName: true } } }, orderBy: [{ dueAt: 'asc' }, { unitId: 'asc' }], ...(filter.take ? { take: filter.take } : {}), ...(filter.skip ? { skip: filter.skip } : {}) });
  return rows.map(({ unit, lease, ...c }) => ({ ...c, unitNo: unit.unitNo, occupantName: lease.occupantName, outstandingMinor: outstandingOf(c), daysOverdue: OPEN_RENT_STATUSES.includes(c.status) ? Math.max(0, Math.floor((now.getTime() - c.dueAt.getTime()) / 86_400_000)) : 0 }));
}

/** Остаток по юнитам (для фильтра «c задолженностью» и карты) — одним запросом. */
export async function outstandingByUnit(tenantId: string): Promise<Map<string, bigint>> {
  const rows = await prisma.rentCharge.findMany({ where: { tenantId, status: { in: ['DUE', 'PARTIAL', 'OVERDUE'] } }, select: { unitId: true, amountMinor: true, receivedMinor: true } });
  const m = new Map<string, bigint>();
  for (const r of rows) m.set(r.unitId, (m.get(r.unitId) ?? 0n) + (r.amountMinor - r.receivedMinor));
  return m;
}

export interface UnitFinance {
  currency: string;
  monthlyRentMinor: bigint | null;
  chargedMinor: bigint; // всего начислено (не WAIVED)
  receivedMinor: bigint;
  outstandingMinor: bigint;
  overdueMinor: bigint;
  overdueCount: number;
  ownerPayoutMinor: bigint | null; // аренда − комиссия управления (для юнитов под управлением)
  feeBp: number;
  lastPaymentAt: Date | null;
  charges: RentChargeRow[];
}

/** Блок Finance карточки юнита (blueprint §1.7): аренда, дебиторка, остаток, выплата собственнику. */
export async function getUnitFinance(ctx: TenantContext, unitId: string, now = new Date()): Promise<UnitFinance> {
  requirePermission(ctx, 'unit.finance.view');
  const unit = await findScopedOr404(prisma.unit, ctx, unitId);
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
  const feeBp = Number((tenant.settings as Record<string, unknown>).management_fee_bp ?? 1000);
  const rows = await prisma.rentCharge.findMany({ where: { tenantId: ctx.tenantId, unitId }, include: { unit: { select: { unitNo: true } }, lease: { select: { occupantName: true } } }, orderBy: { periodStart: 'desc' } });
  const charges: RentChargeRow[] = rows.map(({ unit: u, lease, ...c }) => ({ ...c, unitNo: u.unitNo, occupantName: lease.occupantName, outstandingMinor: outstandingOf(c), daysOverdue: OPEN_RENT_STATUSES.includes(c.status) ? Math.max(0, Math.floor((now.getTime() - c.dueAt.getTime()) / 86_400_000)) : 0 }));
  const live = charges.filter((c) => c.status !== 'WAIVED');
  const overdue = charges.filter((c) => c.status === 'OVERDUE');
  const sum = (xs: RentChargeRow[], f: (c: RentChargeRow) => bigint) => xs.reduce((a, c) => a + f(c), 0n);
  const rent = unit.monthlyRentMinor;
  return {
    currency: charges[0]?.currency ?? unit.askingCurrency,
    monthlyRentMinor: rent,
    chargedMinor: sum(live, (c) => c.amountMinor),
    receivedMinor: sum(live, (c) => c.receivedMinor),
    outstandingMinor: sum(live, (c) => c.outstandingMinor),
    overdueMinor: sum(overdue, (c) => c.outstandingMinor),
    overdueCount: overdue.length,
    ownerPayoutMinor: rent != null ? (unit.managedByPlatform ? rent - (rent * BigInt(feeBp)) / 10_000n : rent) : null,
    feeBp,
    lastPaymentAt: charges.filter((c) => c.paidAt).sort((a, b) => b.paidAt!.getTime() - a.paidAt!.getTime())[0]?.paidAt ?? null,
    charges: charges.slice(0, 12),
  };
}

export interface ReceivablesSummary {
  currency: string;
  outstandingMinor: bigint;
  overdueMinor: bigint;
  overdueCount: number;
  debtorUnits: number;
  monthChargedMinor: bigint;
  monthReceivedMinor: bigint;
  collectionPct: number | null;
  topDebtors: { unitId: string; unitNo: string; occupantName: string; outstandingMinor: bigint; daysOverdue: number }[];
}

/** Блок Finance пульта (blueprint §9): дебиторка, просрочка, сбор за текущий месяц, должники. */
export async function getReceivablesSummary(ctx: TenantContext, now = new Date()): Promise<ReceivablesSummary> {
  requirePermission(ctx, 'rent.view');
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await listRentCharges(ctx, {}, now);
  const open = rows.filter((c) => OPEN_RENT_STATUSES.includes(c.status));
  const overdue = open.filter((c) => c.status === 'OVERDUE');
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const month = rows.filter((c) => c.status !== 'WAIVED' && c.periodStart >= monthStart && c.periodStart < nextMonth);
  const sum = (xs: RentChargeRow[], f: (c: RentChargeRow) => bigint) => xs.reduce((a, c) => a + f(c), 0n);
  const byUnit = new Map<string, { unitId: string; unitNo: string; occupantName: string; outstandingMinor: bigint; daysOverdue: number }>();
  for (const c of open) {
    const cur = byUnit.get(c.unitId) ?? { unitId: c.unitId, unitNo: c.unitNo, occupantName: c.occupantName, outstandingMinor: 0n, daysOverdue: 0 };
    cur.outstandingMinor += c.outstandingMinor;
    cur.daysOverdue = Math.max(cur.daysOverdue, c.daysOverdue);
    byUnit.set(c.unitId, cur);
  }
  const charged = sum(month, (c) => c.amountMinor);
  const received = sum(month, (c) => c.receivedMinor);
  return {
    currency: rows[0]?.currency ?? 'USD',
    outstandingMinor: sum(open, (c) => c.outstandingMinor),
    overdueMinor: sum(overdue, (c) => c.outstandingMinor),
    overdueCount: overdue.length,
    debtorUnits: byUnit.size,
    monthChargedMinor: charged,
    monthReceivedMinor: received,
    collectionPct: charged > 0n ? Math.round(Number((received * 1000n) / charged)) / 10 : null,
    topDebtors: [...byUnit.values()].sort((a, b) => Number(b.outstandingMinor - a.outstandingMinor)).slice(0, 8),
  };
}

/** Нераспределённые поступления для формы зачёта (без PII сверх имени контрагента, которое уже в выписке). */
export async function listUnmatchedIncoming(ctx: TenantContext, take = 50) {
  requirePermission(ctx, 'rent.match');
  const where: Prisma.BankTransactionWhereInput = { tenantId: ctx.tenantId, amountMinor: { gt: 0n }, matchStatus: { in: ['UNMATCHED', 'SUGGESTED', 'MANUAL_MATCHED'] } };
  const rows = await prisma.bankTransaction.findMany({ where, include: { matches: { select: { amountMinor: true } } }, orderBy: { bookingDate: 'desc' }, take: take * 2 });
  return rows.map((t) => ({ id: t.id, bookingDate: t.bookingDate, amountMinor: t.amountMinor, currency: t.currency, counterpartyName: t.counterpartyName, purposeText: t.purposeText, remainingMinor: t.amountMinor - t.matches.reduce((a, m) => a + m.amountMinor, 0n) })).filter((t) => t.remainingMinor > 0n).slice(0, take);
}

export function canSeeRent(ctx: TenantContext): boolean {
  return can(ctx, 'rent.view');
}

export { NotFoundError as RentNotFoundError };
