/**
 * ORDO Operations — деньги дома (docs/20 §11.13; бизнес-модель Operations v1.0; ЗРУ-581 ст. 16, 28, 29).
 * BR-P51 взносы по кадастровой площади · BR-P52 деньги дома ≠ деньги ORDO (фонд, отдельный счёт, вознаграждение строкой)
 * · BR-P53 PAID только банком · BR-P54 годовой перерасчёт. Прозрачность как продукт: отчёт «деньги · работы · качество · дальше».
 */
import type { HouseBudgetCategory, HouseFundKind, ManagementContractStatus, TenantContext } from '@finance-os/core';
import { NotFoundError, OPEN_RENT_STATUSES, ValidationError, annualRecalc, budgetVsActual, can, collectionScenarios, houseContribution, houseDueAt, managementFeeLine, outstandingOf, rentChargeStatus, requirePermission, validateReceipt } from '@finance-os/core';
import type { HouseCharge, HouseExpense, HouseFund, Prisma } from '@prisma/client';
import { Prisma as P } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404 } from '../repository.js';
import { nextNumber } from '../sequence.js';
import { emitDomainEvent } from './domainEvents.js';

const pickFund = (f: HouseFund) => ({ kind: f.kind, name: f.name, tariffPerM2Minor: f.tariffPerM2Minor, currency: f.currency, managementFeeBp: f.managementFeeBp, dueDay: f.dueDay, active: f.active, bankAccountId: f.bankAccountId, buildingId: f.buildingId });
const pickC = (c: HouseCharge) => ({ status: c.status, amountMinor: c.amountMinor, receivedMinor: c.receivedMinor, dueAt: c.dueAt, periodStart: c.periodStart, unitId: c.unitId, fundId: c.fundId });

export interface FundInput { buildingId?: string | null; kind?: HouseFundKind; name: string; bankAccountId?: string | null; tariffPerM2Minor: bigint; currency?: string; managementFeeBp?: number | null; dueDay?: number; tariffApprovedAt?: Date | null }

function validateFund(i: Partial<FundInput>) {
  if (i.name !== undefined && !i.name.trim()) throw new ValidationError('NAME_REQUIRED');
  if (i.tariffPerM2Minor !== undefined && i.tariffPerM2Minor < 0n) throw new ValidationError('TARIFF_INVALID');
  if (i.managementFeeBp != null && (i.managementFeeBp < 0 || i.managementFeeBp > 10_000)) throw new ValidationError('FEE_INVALID');
  if (i.dueDay !== undefined && (!Number.isInteger(i.dueDay) || i.dueDay < 1 || i.dueDay > 28)) throw new ValidationError('DUE_DAY_INVALID');
}

export async function createHouseFund(ctx: TenantContext, input: FundInput): Promise<HouseFund> {
  requirePermission(ctx, 'house.manage');
  validateFund(input);
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    if (input.buildingId) await findScopedOr404(tx.building, ctx, input.buildingId);
    if (input.bankAccountId) await findScopedOr404(tx.bankAccount, ctx, input.bankAccountId);
    const created = await tx.houseFund.create({ data: { tenantId: ctx.tenantId, buildingId: input.buildingId ?? null, kind: input.kind ?? 'OPERATIONS', name: input.name.trim(), bankAccountId: input.bankAccountId ?? null, tariffPerM2Minor: input.tariffPerM2Minor, currency: input.currency ?? 'UZS', managementFeeBp: input.managementFeeBp ?? null, dueDay: input.dueDay ?? 15, tariffApprovedAt: input.tariffApprovedAt ?? null } });
    return { result: created, audit: { action: 'house_fund.create', objectType: 'house_fund', objectId: created.id, after: pickFund(created) } };
  });
}

export async function updateHouseFund(ctx: TenantContext, id: string, patch: Partial<FundInput> & { active?: boolean }): Promise<HouseFund> {
  requirePermission(ctx, 'house.manage');
  validateFund(patch);
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.houseFund, ctx, id);
    const after = await tx.houseFund.update({ where: { id }, data: { ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), ...(patch.tariffPerM2Minor !== undefined ? { tariffPerM2Minor: patch.tariffPerM2Minor } : {}), ...(patch.managementFeeBp !== undefined ? { managementFeeBp: patch.managementFeeBp } : {}), ...(patch.dueDay !== undefined ? { dueDay: patch.dueDay } : {}), ...(patch.bankAccountId !== undefined ? { bankAccountId: patch.bankAccountId } : {}), ...(patch.tariffApprovedAt !== undefined ? { tariffApprovedAt: patch.tariffApprovedAt } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}) } });
    return { result: after, audit: { action: 'house_fund.update', objectType: 'house_fund', objectId: id, before: pickFund(before), after: pickFund(after) } };
  });
}

export async function upsertHouseBudgetLine(ctx: TenantContext, input: { fundId: string; year: number; category: HouseBudgetCategory; plannedMinor: bigint; note?: string | null }) {
  requirePermission(ctx, 'house.manage');
  if (input.plannedMinor < 0n) throw new ValidationError('AMOUNT_INVALID');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    await findScopedOr404(tx.houseFund, ctx, input.fundId);
    const row = await tx.houseBudgetLine.upsert({ where: { fundId_year_category: { fundId: input.fundId, year: input.year, category: input.category } }, create: { tenantId: ctx.tenantId, fundId: input.fundId, year: input.year, category: input.category, plannedMinor: input.plannedMinor, note: input.note ?? null }, update: { plannedMinor: input.plannedMinor, ...(input.note !== undefined ? { note: input.note } : {}) } });
    return { result: row, audit: { action: 'house_budget.upsert', objectType: 'house_budget_line', objectId: row.id, after: { fundId: input.fundId, year: input.year, category: input.category, plannedMinor: input.plannedMinor.toString() } } };
  });
}

/** Расход из денег дома: подрядчик, статья, основание. Каждый расход существует только c документом или заявкой на оплату (прозрачность §5). */
export async function addHouseExpense(ctx: TenantContext, input: { fundId: string; date: Date; category: HouseBudgetCategory; amountMinor: bigint; contractorName: string; description: string; documentId?: string | null; paymentRequestId?: string | null; workOrderId?: string | null }): Promise<HouseExpense> {
  requirePermission(ctx, 'house.manage');
  if (input.amountMinor <= 0n) throw new ValidationError('AMOUNT_INVALID');
  if (!input.contractorName.trim()) throw new ValidationError('CONTRACTOR_REQUIRED');
  if (!input.description.trim()) throw new ValidationError('DESCRIPTION_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const fund = await findScopedOr404(tx.houseFund, ctx, input.fundId);
    if (input.documentId) await findScopedOr404(tx.document, ctx, input.documentId);
    if (input.paymentRequestId) await findScopedOr404(tx.paymentRequest, ctx, input.paymentRequestId);
    const created = await tx.houseExpense.create({ data: { tenantId: ctx.tenantId, fundId: fund.id, date: input.date, category: input.category, amountMinor: input.amountMinor, currency: fund.currency, contractorName: input.contractorName.trim(), description: input.description.trim(), documentId: input.documentId ?? null, paymentRequestId: input.paymentRequestId ?? null, workOrderId: input.workOrderId ?? null, createdBy: ctx.userId } });
    return { result: created, audit: { action: 'house_expense.create', objectType: 'house_expense', objectId: created.id, after: { fundId: fund.id, category: created.category, amountMinor: created.amountMinor.toString(), contractorName: created.contractorName, hasDocument: !!created.documentId } } };
  });
}

/** Джоб house-charges: взнос каждому собственнику за месяц по всем юнитам здания фонда (BR-P51); юниты без собственника — в отчёт «без плательщика». */
export async function generateHouseCharges(tenantId: string, now = new Date(), opts: { fromMonth?: Date } = {}): Promise<{ created: number; withoutOwner: number }> {
  const funds = await prisma.houseFund.findMany({ where: { tenantId, active: true, kind: 'OPERATIONS' } });
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  let created = 0; let withoutOwner = 0;
  for (const f of funds) {
    const units = await prisma.unit.findMany({ where: { tenantId, ...(f.buildingId ? { buildingId: f.buildingId } : {}), type: { notIn: ['COMMON', 'TECHNICAL'] } }, select: { id: true, ownerId: true, areaM2: true, cadastralAreaM2: true, unitNo: true } });
    withoutOwner += units.filter((u) => !u.ownerId).length;
    const months: Date[] = [];
    let cursor = opts.fromMonth ? new Date(Date.UTC(opts.fromMonth.getUTCFullYear(), opts.fromMonth.getUTCMonth(), 1)) : monthStart;
    while (cursor <= monthStart) { months.push(cursor); cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)); }
    const existing = new Set((await prisma.houseCharge.findMany({ where: { fundId: f.id, periodStart: { gte: months[0] ?? monthStart } }, select: { unitId: true, periodStart: true } })).map((c) => `${c.unitId}:${c.periodStart.toISOString().slice(0, 10)}`));
    for (const m of months) for (const u of units) {
      if (!u.ownerId || existing.has(`${u.id}:${m.toISOString().slice(0, 10)}`)) continue;
      const calc = houseContribution(Number(u.areaM2), u.cadastralAreaM2 != null ? Number(u.cadastralAreaM2) : null, f.tariffPerM2Minor);
      await withAudit({ tenantId }, async (tx) => {
        const number = await nextNumber(tx, tenantId, 'HC', now);
        const c = await tx.houseCharge.create({ data: { tenantId, number, fundId: f.id, unitId: u.id, ownerId: u.ownerId!, periodStart: m, dueAt: houseDueAt(m, f.dueDay), areaM2: new P.Decimal(calc.areaM2), preCadastre: calc.preCadastre, tariffMinor: f.tariffPerM2Minor, amountMinor: calc.amountMinor, currency: f.currency } });
        return { result: c, audit: { action: 'house_charge.create', objectType: 'house_charge', objectId: c.id, after: { number, ...pickC(c), unitNo: u.unitNo, preCadastre: calc.preCadastre } } };
      });
      created++;
    }
  }
  return { created, withoutOwner };
}

/** Джоб house-overdue: просроченные → OVERDUE + Task HOUSE_CHARGE_OVERDUE (дедуп по собственнику) + событие; список должников — для enforcement-механики 2026. */
export async function markOverdueHouseCharges(tenantId: string, now = new Date()): Promise<number> {
  const rows = await prisma.houseCharge.findMany({ where: { tenantId, status: { in: ['DUE', 'PARTIAL'] }, dueAt: { lt: now }, overdueNotifiedAt: null }, include: { unit: { select: { unitNo: true } } } });
  let n = 0;
  for (const c of rows) {
    if (rentChargeStatus(c, now) !== 'OVERDUE') continue;
    await withAudit({ tenantId }, async (tx) => {
      const ops = (await tx.userTenantRole.findFirst({ where: { tenantId, role: { in: ['FINANCE_OPS_LEAD', 'OPERATIONS_MANAGER'] } }, orderBy: { role: 'asc' }, select: { userId: true } }))?.userId ?? null;
      const exists = await tx.task.count({ where: { tenantId, type: 'HOUSE_CHARGE_OVERDUE', objectId: c.ownerId, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
      if (!exists) await tx.task.create({ data: { tenantId, type: 'HOUSE_CHARGE_OVERDUE', objectType: 'property_owner', objectId: c.ownerId, ownerId: ops, dueAt: c.dueAt, nextAction: `Взнос на содержание ${c.unit.unitNo} за ${c.periodStart.toISOString().slice(0, 7)} просрочен: уведомить собственника, при повторе — механика счёта дома (пени, блокировка электроэнергии)` } });
      const after = await tx.houseCharge.update({ where: { id: c.id }, data: { status: 'OVERDUE', overdueNotifiedAt: now } });
      await emitDomainEvent(tx, tenantId, 'house.charge.overdue', 'house_charge', c.id, { number: c.number, unitNo: c.unit.unitNo, period: c.periodStart.toISOString().slice(0, 7), deepLink: '/house?view=charges' });
      return { result: after, audit: { action: 'house_charge.overdue', objectType: 'house_charge', objectId: c.id, before: pickC(c), after: pickC(after) } };
    });
    n++;
  }
  return n;
}

/** BR-P53: зачёт поступления на счёт дома в взнос — единственный путь к PAID. */
export async function matchHouseReceipt(ctx: TenantContext, input: { bankTransactionId: string; houseChargeId: string; amountMinor?: bigint | null }, now = new Date()): Promise<HouseCharge> {
  requirePermission(ctx, 'rent.match');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const c = await findScopedOr404(tx.houseCharge, ctx, input.houseChargeId);
    const bankTx = await findScopedOr404(tx.bankTransaction, ctx, input.bankTransactionId);
    const fund = await tx.houseFund.findUniqueOrThrow({ where: { id: c.fundId } });
    if (fund.bankAccountId && bankTx.bankAccountId !== fund.bankAccountId) throw new ValidationError('WRONG_ACCOUNT', 'WRONG_ACCOUNT: взносы принимаются только на счёт дома (BR-P52)');
    if (bankTx.amountMinor <= 0n) throw new ValidationError('TX_NOT_INCOMING');
    if (bankTx.matchStatus === 'IGNORED') throw new ValidationError('TX_IGNORED');
    if (!OPEN_RENT_STATUSES.includes(c.status)) throw new ValidationError('CHARGE_NOT_OPEN');
    const already = (await tx.reconciliationMatch.aggregate({ where: { bankTransactionId: bankTx.id }, _sum: { amountMinor: true } }))._sum.amountMinor ?? 0n;
    const same = bankTx.currency === c.currency;
    let amount = input.amountMinor ?? (same ? bankTx.amountMinor - already : null);
    if (amount == null) throw new ValidationError('AMOUNT_REQUIRED');
    amount = validateReceipt(amount, outstandingOf(c));
    if (same && amount > bankTx.amountMinor - already) throw new ValidationError('TX_EXHAUSTED');
    await tx.reconciliationMatch.create({ data: { tenantId: ctx.tenantId, bankTransactionId: bankTx.id, objectType: 'HOUSE_CHARGE', objectId: c.id, amountMinor: amount, matchedBy: ctx.userId, method: 'MANUAL', confidence: 1 } });
    await tx.bankTransaction.update({ where: { id: bankTx.id }, data: { matchStatus: 'MANUAL_MATCHED' } });
    const received = c.receivedMinor + amount;
    const status = rentChargeStatus({ amountMinor: c.amountMinor, receivedMinor: received, dueAt: c.dueAt }, now);
    const after = await tx.houseCharge.update({ where: { id: c.id }, data: { receivedMinor: received, status, paidAt: status === 'PAID' ? now : null } });
    return { result: after, audit: { action: 'house_charge.receipt', objectType: 'house_charge', objectId: c.id, before: pickC(c), after: { ...pickC(after), bankTransactionId: bankTx.id, amountMinor: amount } } };
  });
}

export interface HouseChargeRow extends HouseCharge { unitNo: string; ownerName: string; outstandingMinor: bigint; daysOverdue: number }

export async function listHouseCharges(ctx: TenantContext, filter: { fundId?: string; status?: HouseCharge['status'][]; ownerId?: string; period?: Date; take?: number; skip?: number } = {}, now = new Date()): Promise<HouseChargeRow[]> {
  if (!filter.ownerId) requirePermission(ctx, 'house.view');
  const where: Prisma.HouseChargeWhereInput = { tenantId: ctx.tenantId, ...(filter.fundId ? { fundId: filter.fundId } : {}), ...(filter.status ? { status: { in: filter.status } } : {}), ...(filter.ownerId ? { ownerId: filter.ownerId } : {}), ...(filter.period ? { periodStart: filter.period } : {}) };
  const rows = await prisma.houseCharge.findMany({ where, include: { unit: { select: { unitNo: true } } }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }], ...(filter.take ? { take: filter.take } : {}), ...(filter.skip ? { skip: filter.skip } : {}) });
  const owners = new Map((await prisma.propertyOwner.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerId))] } }, select: { id: true, displayName: true } })).map((o) => [o.id, o.displayName]));
  return rows.map(({ unit, ...c }) => ({ ...c, unitNo: unit.unitNo, ownerName: owners.get(c.ownerId) ?? '—', outstandingMinor: outstandingOf(c), daysOverdue: OPEN_RENT_STATUSES.includes(c.status) ? Math.max(0, Math.floor((now.getTime() - c.dueAt.getTime()) / 86_400_000)) : 0 }));
}

export async function listHouseFunds(ctx: TenantContext): Promise<HouseFund[]> {
  requirePermission(ctx, 'house.view');
  return prisma.houseFund.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
}

/** Дашборд фонда за год: собираемость, план/факт, вознаграждение строкой, перерасчёт, должники, сценарии, юниты без плательщика. */
export async function getHouseDashboard(ctx: TenantContext, fundId?: string, year = new Date().getUTCFullYear(), now = new Date()) {
  requirePermission(ctx, 'house.view');
  const fund = fundId ? await findScopedOr404(prisma.houseFund, ctx, fundId) : await prisma.houseFund.findFirst({ where: { tenantId: ctx.tenantId, active: true, kind: 'OPERATIONS' }, orderBy: { createdAt: 'asc' } });
  if (!fund) throw new NotFoundError('FUND_NOT_FOUND');
  const yStart = new Date(Date.UTC(year, 0, 1)); const yEnd = new Date(Date.UTC(year + 1, 0, 1));
  const [charges, expenses, plan, units, funds] = await Promise.all([
    listHouseCharges(ctx, { fundId: fund.id }, now).then((rows) => rows.filter((c) => c.periodStart >= yStart && c.periodStart < yEnd)),
    prisma.houseExpense.findMany({ where: { tenantId: ctx.tenantId, fundId: fund.id, date: { gte: yStart, lt: yEnd } }, orderBy: { date: 'desc' } }),
    prisma.houseBudgetLine.findMany({ where: { fundId: fund.id, year } }),
    prisma.unit.findMany({ where: { tenantId: ctx.tenantId, ...(fund.buildingId ? { buildingId: fund.buildingId } : {}), type: { notIn: ['COMMON', 'TECHNICAL'] } }, select: { id: true, ownerId: true, areaM2: true, cadastralAreaM2: true, unitNo: true } }),
    listHouseFunds(ctx),
  ]);
  const sum = <T,>(xs: T[], f: (x: T) => bigint) => xs.reduce((a, x) => a + f(x), 0n);
  const charged = sum(charges, (c) => c.amountMinor); const collected = sum(charges, (c) => c.receivedMinor); const spent = sum(expenses, (e) => e.amountMinor);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const month = charges.filter((c) => c.periodStart.getTime() === monthStart.getTime());
  const open = charges.filter((c) => OPEN_RENT_STATUSES.includes(c.status));
  const debtors = new Map<string, { ownerId: string; ownerName: string; unitNos: string[]; outstandingMinor: bigint; daysOverdue: number }>();
  for (const c of open) { const d = debtors.get(c.ownerId) ?? { ownerId: c.ownerId, ownerName: c.ownerName, unitNos: [], outstandingMinor: 0n, daysOverdue: 0 }; if (!d.unitNos.includes(c.unitNo)) d.unitNos.push(c.unitNo); d.outstandingMinor += c.outstandingMinor; d.daysOverdue = Math.max(d.daysOverdue, c.daysOverdue); debtors.set(c.ownerId, d); }
  const payableArea = units.reduce((a, u) => a + Number(u.cadastralAreaM2 ?? u.areaM2), 0);
  const byMonth = Array.from({ length: 12 }, (_, m) => { const ms = new Date(Date.UTC(year, m, 1)); const xs = charges.filter((c) => c.periodStart.getTime() === ms.getTime()); return { month: m + 1, chargedMinor: sum(xs, (c) => c.amountMinor), collectedMinor: sum(xs, (c) => c.receivedMinor) }; }).filter((x) => x.chargedMinor > 0n);
  const showFee = can(ctx, 'house.manage') || can(ctx, 'mall.fee.view');
  return {
    fund: { id: fund.id, name: fund.name, kind: fund.kind, currency: fund.currency, tariffPerM2Minor: fund.tariffPerM2Minor, managementFeeBp: fund.managementFeeBp, dueDay: fund.dueDay, tariffApprovedAt: fund.tariffApprovedAt, bankAccountId: fund.bankAccountId, buildingId: fund.buildingId }, funds, year,
    money: { chargedMinor: charged, collectedMinor: collected, spentMinor: spent, outstandingMinor: sum(open, (c) => c.outstandingMinor), overdueMinor: sum(open.filter((c) => c.status === 'OVERDUE'), (c) => c.outstandingMinor), collectionPct: charged > 0n ? Math.round(Number((collected * 1000n) / charged)) / 10 : null, monthChargedMinor: sum(month, (c) => c.amountMinor), monthCollectedMinor: sum(month, (c) => c.receivedMinor), managementFeeMinor: showFee ? managementFeeLine(collected, fund.managementFeeBp) : null, feeOpen: fund.managementFeeBp == null },
    recalc: annualRecalc(charged, collected, spent), scenarios: collectionScenarios(charged),
    budget: budgetVsActual(plan.map((p) => ({ category: p.category, plannedMinor: p.plannedMinor })), expenses.map((e) => ({ category: e.category, amountMinor: e.amountMinor }))),
    plannedTotalMinor: sum(plan, (p) => p.plannedMinor), byMonth,
    units: { total: units.length, withOwner: units.filter((u) => u.ownerId).length, withoutOwner: units.filter((u) => !u.ownerId).map((u) => u.unitNo), preCadastre: units.filter((u) => u.cadastralAreaM2 == null).length, payableAreaM2: Math.round(payableArea * 100) / 100 },
    debtors: [...debtors.values()].sort((a, b) => Number(b.outstandingMinor - a.outstandingMinor)).slice(0, 15),
    expenses: expenses.slice(0, 20),
  };
}

/** Отчёт собственнику за месяц (ст. 29 + Transparency Product §5): деньги · работы · качество · дальше. */
export async function getTransparencyReport(ctx: TenantContext, fundId: string, period: string, now = new Date()) {
  if (!can(ctx, 'house.view')) requirePermission(ctx, 'owner.portal');
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ValidationError('PERIOD_INVALID');
  const fund = await findScopedOr404(prisma.houseFund, ctx, fundId);
  const [y, m] = period.split('-').map(Number);
  const from = new Date(Date.UTC(y!, m! - 1, 1)); const to = new Date(Date.UTC(y!, m!, 1));
  const [charges, expenses, plan, workOrders, incidents] = await Promise.all([
    prisma.houseCharge.findMany({ where: { tenantId: ctx.tenantId, fundId: fund.id, periodStart: from } }),
    prisma.houseExpense.findMany({ where: { tenantId: ctx.tenantId, fundId: fund.id, date: { gte: from, lt: to } }, orderBy: { date: 'asc' } }),
    prisma.houseBudgetLine.findMany({ where: { fundId: fund.id, year: y! } }),
    prisma.workOrder.findMany({ where: { tenantId: ctx.tenantId, ...(fund.buildingId ? { buildingId: fund.buildingId } : {}), OR: [{ createdAt: { gte: from, lt: to } }, { doneAt: { gte: from, lt: to } }] }, select: { status: true, priority: true, category: true, slaDueAt: true, doneAt: true, title: true, contractorName: true } }),
    prisma.workOrder.count({ where: { tenantId: ctx.tenantId, ...(fund.buildingId ? { buildingId: fund.buildingId } : {}), priority: 'CRITICAL', createdAt: { gte: from, lt: to } } }),
  ]);
  const sum = <T,>(xs: T[], f: (x: T) => bigint) => xs.reduce((a, x) => a + f(x), 0n);
  const charged = sum(charges, (c) => c.amountMinor); const collected = sum(charges, (c) => c.receivedMinor);
  const done = workOrders.filter((w) => w.doneAt && w.doneAt >= from && w.doneAt < to);
  const onTime = done.filter((w) => w.doneAt! <= w.slaDueAt).length;
  const monthlyPlan = plan.map((p) => ({ category: p.category, plannedMinor: p.plannedMinor / 12n }));
  return {
    fund: { id: fund.id, name: fund.name, currency: fund.currency, tariffPerM2Minor: fund.tariffPerM2Minor }, period,
    money: { chargedMinor: charged, collectedMinor: collected, outstandingMinor: sum(charges.filter((c) => c.status !== 'PAID'), (c) => c.amountMinor - c.receivedMinor), collectionPct: charged > 0n ? Math.round(Number((collected * 1000n) / charged)) / 10 : null, spentMinor: sum(expenses, (e) => e.amountMinor), managementFeeMinor: managementFeeLine(collected, fund.managementFeeBp), feeOpen: fund.managementFeeBp == null, budget: budgetVsActual(monthlyPlan, expenses.map((e) => ({ category: e.category, amountMinor: e.amountMinor }))) },
    works: { done: done.map((w) => ({ title: w.title, category: w.category, contractorName: w.contractorName, onTime: w.doneAt! <= w.slaDueAt })), open: workOrders.filter((w) => ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(w.status)).length, expenses: expenses.map((e) => ({ date: e.date, category: e.category, amountMinor: e.amountMinor, contractorName: e.contractorName, description: e.description, hasDocument: !!e.documentId })) },
    quality: { slaPct: done.length ? Math.round((onTime / done.length) * 1000) / 10 : null, incidents: incidents, doneCount: done.length },
    next: { openWorkOrders: workOrders.filter((w) => ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(w.status)).map((w) => w.title).slice(0, 8), decisionsNeeded: fund.managementFeeBp == null ? ['Размер вознаграждения управляющей организации (ожидается заключение Quantum Law)'] : [], tariffApproved: !!fund.tariffApprovedAt },
    generatedAt: now,
  };
}

/** Кабинет собственника: взносы по своим помещениям, остаток, ссылка на отчёт дома. */
export async function ownerHouseReport(ctx: TenantContext, ownerId: string, now = new Date()) {
  const charges = await listHouseCharges(ctx, { ownerId }, now);
  if (charges.length === 0) return null;
  const fundIds = [...new Set(charges.map((c) => c.fundId))];
  const funds = await prisma.houseFund.findMany({ where: { id: { in: fundIds } }, select: { id: true, name: true, tariffPerM2Minor: true, currency: true, dueDay: true, managementFeeBp: true } });
  const open = charges.filter((c) => OPEN_RENT_STATUSES.includes(c.status));
  return { funds, charges: charges.slice(0, 12), outstandingMinor: open.reduce((a, c) => a + c.outstandingMinor, 0n), overdue: open.filter((c) => c.status === 'OVERDUE').length, currency: charges[0]!.currency };
}

/** ст. 28: договор управления письменно c каждым собственником — статус и дата. */
export async function setManagementContractStatus(ctx: TenantContext, ownerId: string, status: ManagementContractStatus, signedAt?: Date | null) {
  requirePermission(ctx, 'property.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.propertyOwner, ctx, ownerId);
    if (status === 'SIGNED' && !(signedAt ?? before.managementContractSignedAt)) throw new ValidationError('SIGNED_AT_REQUIRED');
    const after = await tx.propertyOwner.update({ where: { id: ownerId }, data: { managementContractStatus: status, managementContractSignedAt: status === 'SIGNED' ? (signedAt ?? before.managementContractSignedAt) : status === 'NONE' ? null : before.managementContractSignedAt } });
    return { result: after, audit: { action: 'property_owner.contract_status', objectType: 'property_owner', objectId: ownerId, before: { status: before.managementContractStatus }, after: { status, signedAt: after.managementContractSignedAt } } };
  });
}

export async function setUnitCadastre(ctx: TenantContext, unitId: string, input: { cadastralNumber?: string | null; cadastralAreaM2?: number | null }) {
  requirePermission(ctx, 'property.manage');
  if (input.cadastralAreaM2 != null && !(input.cadastralAreaM2 > 0)) throw new ValidationError('AREA_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.unit, ctx, unitId);
    const after = await tx.unit.update({ where: { id: unitId }, data: { ...(input.cadastralNumber !== undefined ? { cadastralNumber: input.cadastralNumber?.trim() || null } : {}), ...(input.cadastralAreaM2 !== undefined ? { cadastralAreaM2: input.cadastralAreaM2 != null ? new P.Decimal(input.cadastralAreaM2) : null } : {}), updatedBy: ctx.userId } });
    return { result: after, audit: { action: 'unit.cadastre', objectType: 'unit', objectId: unitId, before: { cadastralNumber: before.cadastralNumber, cadastralAreaM2: before.cadastralAreaM2?.toString() ?? null }, after: { cadastralNumber: after.cadastralNumber, cadastralAreaM2: after.cadastralAreaM2?.toString() ?? null } } };
  });
}

/** Сводка договоров управления по собственникам здания (ст. 28): подписано / отправлено / нет. */
export async function managementContractCoverage(ctx: TenantContext) {
  requirePermission(ctx, 'house.view');
  const owners = await prisma.propertyOwner.findMany({ where: { tenantId: ctx.tenantId, units: { some: {} } }, select: { managementContractStatus: true } });
  const by = (s: ManagementContractStatus) => owners.filter((o) => o.managementContractStatus === s).length;
  return { total: owners.length, signed: by('SIGNED'), sent: by('SENT'), none: by('NONE'), declined: by('DECLINED'), signedPct: owners.length ? Math.round((by('SIGNED') / owners.length) * 1000) / 10 : null };
}

/** Незачтённые поступления на счёт дома (для формы зачёта, BR-P52/P53). Без счёта у фонда — все входящие. */
export async function listHouseIncoming(ctx: TenantContext, fundId: string, take = 50) {
  requirePermission(ctx, 'rent.match');
  const fund = await findScopedOr404(prisma.houseFund, ctx, fundId);
  const rows = await prisma.bankTransaction.findMany({ where: { tenantId: ctx.tenantId, ...(fund.bankAccountId ? { bankAccountId: fund.bankAccountId } : {}), amountMinor: { gt: 0n }, matchStatus: { in: ['UNMATCHED', 'SUGGESTED', 'MANUAL_MATCHED'] } }, include: { matches: { select: { amountMinor: true } } }, orderBy: { bookingDate: 'desc' }, take: take * 2 });
  return rows.map((t) => ({ id: t.id, bookingDate: t.bookingDate, amountMinor: t.amountMinor, currency: t.currency, counterpartyName: t.counterpartyName, purposeText: t.purposeText, remainingMinor: t.amountMinor - t.matches.reduce((a, m) => a + m.amountMinor, 0n) })).filter((t) => t.remainingMinor > 0n).slice(0, take);
}

/** Счета тенанта для привязки фонда (только маскированный номер — реквизиты не раскрываются). */
export async function listHouseBankAccounts(ctx: TenantContext) {
  requirePermission(ctx, 'house.manage');
  return prisma.bankAccount.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, select: { id: true, bankName: true, accountMasked: true, currency: true }, orderBy: { bankName: 'asc' } });
}
