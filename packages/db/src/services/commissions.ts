/**
 * Комиссии ORDO и бонусы продажников (docs/20 §11.10; blueprint §17; Tower §2; решения владельца 19.09.2026).
 * BR-P41 комиссия по правилу продукта на WON · BR-P42 PAID только банковской транзакцией · BR-P43 бонус 20% + 10% KPI /
 * треть комиссии при продаже, к выплате после поступления · BR-P44 отмена комиссии до поступления → бонус удержан.
 */
import type { AuditEntry, BonusStatus, DealProduct, KpiChecklistItem, TenantContext } from '@finance-os/core';
import { KPI_CHECKLIST_ITEMS, LEASE_PRODUCTS, NotFoundError, ValidationError, assertKpiConfirmable, bonusLines, bonusSettingsFrom, can, computeCommission, deriveBonusStatus, hasRole, kpiDeadline, requirePermission, validateReceipt } from '@finance-os/core';
import type { Commission, Deal, Prisma, SalesBonus } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { nextNumber } from '../sequence.js';
import { emitDomainEvent } from './domainEvents.js';

const COMMISSION_DUE_DAYS = 14;
const pickC = (c: Commission) => ({ status: c.status, product: c.product, payer: c.payer, baseMinor: c.baseMinor, rateBp: c.rateBp, amountMinor: c.amountMinor, netMinor: c.netMinor, receivedMinor: c.receivedMinor, externalShareBp: c.externalShareBp });
const pickB = (b: SalesBonus) => ({ status: b.status, kind: b.kind, employeeId: b.employeeId, amountMinor: b.amountMinor, rateBp: b.rateBp });

async function settingsOf(tx: Prisma.TransactionClient, tenantId: string) {
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  return bonusSettingsFrom(t?.settings as Record<string, unknown> | null);
}

/** Пересчёт статусов бонусов комиссии по BR-P43/P44 (внутри транзакции вызывающего); возвращает записи audit для withAudit. */
async function syncBonuses(tx: Prisma.TransactionClient, commission: Commission, now: Date, withheldReason?: string): Promise<AuditEntry[]> {
  const bonuses = await tx.salesBonus.findMany({ where: { commissionId: commission.id } });
  const audit: AuditEntry[] = [];
  for (const b of bonuses) {
    const next = deriveBonusStatus({ kind: b.kind, current: b.status, commissionStatus: commission.status, kpiConfirmed: !!b.kpiConfirmedAt, kpiDeadlinePassed: !!b.kpiDeadline && now > b.kpiDeadline });
    if (next === b.status) continue;
    const after = await tx.salesBonus.update({ where: { id: b.id }, data: { status: next, ...(next === 'PAYABLE' ? { payableAt: now } : {}), ...(next === 'WITHHELD' ? { withheldReason: withheldReason ?? (b.kind === 'KPI' && !b.kpiConfirmedAt ? 'KPI_DEADLINE_PASSED' : 'COMMISSION_CANCELLED') } : {}) } });
    audit.push({ action: 'sales_bonus.status', objectType: 'sales_bonus', objectId: b.id, before: pickB(b), after: pickB(after) });
  }
  return audit;
}

/**
 * BR-P41: начисление комиссии ORDO при WON (вызывается из activateLease и closeSale внутри их транзакции).
 * Возвращает null, если ставка продукта не утверждена (STR/Mall) — сделка выигрывается, но комиссия ждёт решения.
 */
export async function accrueCommission(tx: Prisma.TransactionClient, ctx: TenantContext, deal: Deal, baseMinor: bigint, payerName: string, currency: string, now = new Date(), leaseStartAt?: Date | null): Promise<Commission | null> {
  const existing = await tx.commission.findUnique({ where: { dealId: deal.id } });
  if (existing) return existing;
  let calc;
  try {
    calc = computeCommission(deal.product, baseMinor, deal.commissionRateBp);
  } catch (e) {
    if (e instanceof ValidationError && e.code === 'COMMISSION_RATE_OPEN') return null;
    throw e;
  }
  const netMinor = calc.amountMinor - (calc.amountMinor * BigInt(deal.externalShareBp)) / 10_000n;
  const number = await nextNumber(tx, ctx.tenantId, 'CM', now);
  const commission = await tx.commission.create({
    data: {
      tenantId: ctx.tenantId, number, dealId: deal.id, unitId: deal.unitId, product: deal.product, payer: calc.payer, payerName, baseMinor: calc.baseMinor, rateBp: calc.rateBp, amountMinor: calc.amountMinor,
      externalBrokerName: deal.externalBrokerName, externalShareBp: deal.externalShareBp, netMinor, currency, dueAt: new Date(now.getTime() + COMMISSION_DUE_DAYS * 86_400_000),
    },
  });
  const settings = await settingsOf(tx, ctx.tenantId);
  const deadline = LEASE_PRODUCTS.includes(deal.product) ? kpiDeadline(leaseStartAt ?? now, settings) : null;
  for (const line of bonusLines(deal.product, netMinor, settings)) {
    await tx.salesBonus.create({ data: { tenantId: ctx.tenantId, dealId: deal.id, commissionId: commission.id, employeeId: deal.managerId, kind: line.kind, rateBp: line.rateBp, baseMinor: netMinor, amountMinor: line.amountMinor, currency, status: line.kind === 'DEAL' ? 'CONFIRMED' : 'POTENTIAL', kpiDeadline: line.kind === 'KPI' ? deadline : null } });
  }
  if (LEASE_PRODUCTS.includes(deal.product)) for (const item of KPI_CHECKLIST_ITEMS) await tx.dealChecklistItem.upsert({ where: { dealId_item: { dealId: deal.id, item } }, create: { tenantId: ctx.tenantId, dealId: deal.id, item }, update: {} });
  await emitDomainEvent(tx, ctx.tenantId, 'commission.accrued', 'commission', commission.id, { number, dealNumber: deal.number, product: deal.product, amountMinor: calc.amountMinor.toString(), deepLink: `/deals/${deal.id}` });
  return commission;
}

/** BR-P44: отмена комиссии (проигрыш/расторжение до поступления) → бонусы удержаны; оплаченная комиссия не отменяется. */
export async function cancelCommissionForDeal(tx: Prisma.TransactionClient, ctx: TenantContext, dealId: string, reason: string, now = new Date()): Promise<{ commission: Commission | null; audit: AuditEntry[] }> {
  const c = await tx.commission.findFirst({ where: { dealId, tenantId: ctx.tenantId } });
  if (!c || c.status === 'PAID' || c.status === 'CANCELLED') return { commission: c, audit: [] };
  if (c.receivedMinor > 0n) return { commission: c, audit: [] }; // частично получено — решение финансов вручную
  const after = await tx.commission.update({ where: { id: c.id }, data: { status: 'CANCELLED', cancelReason: reason } });
  const audit: AuditEntry[] = [{ action: 'commission.cancel', objectType: 'commission', objectId: c.id, before: pickC(c), after: { ...pickC(after), reason } }, ...(await syncBonuses(tx, after, now, 'COMMISSION_CANCELLED'))];
  return { commission: after, audit };
}

/** Закрытие продажи (SALE/PARKING_SALE): WON + комиссия c продавца по цене сделки. */
export async function closeSale(ctx: TenantContext, dealId: string, input: { salePriceMinor: bigint; currency?: string; closedAt?: Date }, now = new Date()): Promise<Deal> {
  requirePermission(ctx, 'deal.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const deal = await findScopedOr404(tx.deal, ctx, dealId);
    if (!['SALE', 'PARKING_SALE'].includes(deal.product)) throw new ValidationError('NOT_A_SALE', 'NOT_A_SALE: закрытие ценой — только для сделок продажи');
    if (input.salePriceMinor <= 0n) throw new ValidationError('SALE_PRICE_REQUIRED');
    const brokerOnly = hasRole(ctx, 'BROKER') && !hasRole(ctx, 'OWNER', 'COMMERCIAL_MANAGER');
    if (brokerOnly && deal.managerId !== ctx.userId) throw new NotFoundError(); // BR-P21
    const { dealMachine } = await import('@finance-os/core');
    dealMachine.assert(ctx, deal.stage, 'win', { brokerOnly, hasUnit: !!deal.unitId, isSale: true, hasSalePrice: true });
    const after = await tx.deal.update({ where: { id: dealId }, data: { stage: 'WON', stageChangedAt: now, wonAt: input.closedAt ?? now, salePriceMinor: input.salePriceMinor, updatedBy: ctx.userId } });
    if (after.unitId) {
      const unit = await tx.unit.findUnique({ where: { id: after.unitId }, select: { unitNo: true, salePriceMinor: true, askingCurrency: true } });
      await tx.unit.update({ where: { id: after.unitId }, data: { commercialStatus: 'OFF_MARKET', salePriceMinor: null, updatedBy: ctx.userId } });
      await accrueCommission(tx, ctx, after, input.salePriceMinor, after.company ?? after.contactName, input.currency ?? unit?.askingCurrency ?? 'USD', now);
    } else await accrueCommission(tx, ctx, after, input.salePriceMinor, after.company ?? after.contactName, input.currency ?? 'USD', now);
    await emitDomainEvent(tx, ctx.tenantId, 'deal.stage.changed', 'deal', dealId, { number: after.number, stage: 'WON', detail: `sale ${input.salePriceMinor}`, deepLink: `/deals/${dealId}` });
    return { result: after, audit: { action: 'deal.stage.change', objectType: 'deal', objectId: dealId, before: { stage: deal.stage }, after: { stage: 'WON', salePriceMinor: input.salePriceMinor.toString() } } };
  });
}

/** BR-P42: зачёт входящей транзакции в комиссию — единственный путь к PAID; бонусы становятся PAYABLE. */
export async function matchCommissionReceipt(ctx: TenantContext, input: { bankTransactionId: string; commissionId: string; amountMinor?: bigint | null }, now = new Date()): Promise<Commission> {
  requirePermission(ctx, 'rent.match');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const c = await findScopedOr404(tx.commission, ctx, input.commissionId);
    const bankTx = await findScopedOr404(tx.bankTransaction, ctx, input.bankTransactionId);
    if (bankTx.amountMinor <= 0n) throw new ValidationError('TX_NOT_INCOMING');
    if (bankTx.matchStatus === 'IGNORED') throw new ValidationError('TX_IGNORED');
    if (c.status === 'PAID' || c.status === 'CANCELLED') throw new ValidationError('COMMISSION_NOT_OPEN');
    const already = (await tx.reconciliationMatch.aggregate({ where: { bankTransactionId: bankTx.id }, _sum: { amountMinor: true } }))._sum.amountMinor ?? 0n;
    const same = bankTx.currency === c.currency;
    let amount = input.amountMinor ?? (same ? bankTx.amountMinor - already : null);
    if (amount == null) throw new ValidationError('AMOUNT_REQUIRED');
    amount = validateReceipt(amount, c.amountMinor - c.receivedMinor);
    if (same && amount > bankTx.amountMinor - already) throw new ValidationError('TX_EXHAUSTED');
    await tx.reconciliationMatch.create({ data: { tenantId: ctx.tenantId, bankTransactionId: bankTx.id, objectType: 'COMMISSION', objectId: c.id, amountMinor: amount, matchedBy: ctx.userId, method: 'MANUAL', confidence: 1 } });
    await tx.bankTransaction.update({ where: { id: bankTx.id }, data: { matchStatus: 'MANUAL_MATCHED' } });
    const received = c.receivedMinor + amount;
    const status = received >= c.amountMinor ? 'PAID' : 'PARTIAL';
    const after = await tx.commission.update({ where: { id: c.id }, data: { receivedMinor: received, status, paidAt: status === 'PAID' ? now : null } });
    const bonusAudit = await syncBonuses(tx, after, now);
    if (status === 'PAID') await emitDomainEvent(tx, ctx.tenantId, 'commission.paid', 'commission', c.id, { number: c.number, amountMinor: c.amountMinor.toString(), deepLink: `/commissions` });
    return { result: after, audit: [{ action: 'commission.receipt', objectType: 'commission', objectId: c.id, before: pickC(c), after: { ...pickC(after), bankTransactionId: bankTx.id, amountMinor: amount } }, ...bonusAudit] };
  });
}

// ── KPI-чек-лист ──

export async function markChecklistItem(ctx: TenantContext, dealId: string, item: KpiChecklistItem, done: boolean, note?: string | null, now = new Date()) {
  requirePermission(ctx, 'deal.checklist');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const deal = await findScopedOr404(tx.deal, ctx, dealId);
    if (deal.stage !== 'WON') throw new ValidationError('DEAL_NOT_WON', 'DEAL_NOT_WON: чек-лист ведётся после выигрыша сделки');
    const kpi = await tx.salesBonus.findFirst({ where: { dealId, kind: 'KPI' } });
    if (kpi?.kpiConfirmedAt) throw new ValidationError('KPI_ALREADY_CONFIRMED');
    const row = await tx.dealChecklistItem.upsert({ where: { dealId_item: { dealId, item } }, create: { tenantId: ctx.tenantId, dealId, item, doneAt: done ? now : null, doneBy: done ? ctx.userId : null, note: note ?? null }, update: { doneAt: done ? now : null, doneBy: done ? ctx.userId : null, ...(note !== undefined ? { note } : {}) } });
    return { result: row, audit: { action: 'deal.checklist', objectType: 'deal', objectId: dealId, after: { item, done, by: ctx.userId } } };
  });
}

/** BR-P43: подтверждение KPI коммерческим менеджером (не продажником), все пункты, в срок → бонус KPI CONFIRMED/PAYABLE. */
export async function confirmKpi(ctx: TenantContext, dealId: string, now = new Date()): Promise<SalesBonus> {
  requirePermission(ctx, 'bonus.confirm_kpi');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const deal = await findScopedOr404(tx.deal, ctx, dealId);
    const kpi = await tx.salesBonus.findFirst({ where: { dealId, kind: 'KPI', tenantId: ctx.tenantId } });
    if (!kpi) throw new NotFoundError('KPI_BONUS_NOT_FOUND');
    if (kpi.status === 'WITHHELD' || kpi.status === 'PAID') throw new ValidationError('KPI_CLOSED');
    const items = await tx.dealChecklistItem.findMany({ where: { dealId } });
    assertKpiConfirmable({ doneItems: items.filter((i) => i.doneAt).map((i) => i.item), confirmerId: ctx.userId, salespersonId: deal.managerId, deadline: kpi.kpiDeadline ?? now, now });
    const commission = await tx.commission.findUniqueOrThrow({ where: { id: kpi.commissionId } });
    const status = deriveBonusStatus({ kind: 'KPI', current: kpi.status, commissionStatus: commission.status, kpiConfirmed: true, kpiDeadlinePassed: false });
    const after = await tx.salesBonus.update({ where: { id: kpi.id }, data: { kpiConfirmedAt: now, kpiConfirmedBy: ctx.userId, status, ...(status === 'PAYABLE' ? { payableAt: now } : {}) } });
    return { result: after, audit: { action: 'sales_bonus.kpi_confirm', objectType: 'sales_bonus', objectId: kpi.id, before: pickB(kpi), after: { ...pickB(after), confirmedBy: ctx.userId } } };
  });
}

/** Джоб bonus-housekeeping: KPI без подтверждения после срока → WITHHELD. */
export async function withholdExpiredKpi(tenantId: string, now = new Date()): Promise<number> {
  const expired = await prisma.salesBonus.findMany({ where: { tenantId, kind: 'KPI', status: { in: ['POTENTIAL'] }, kpiConfirmedAt: null, kpiDeadline: { lt: now } } });
  for (const b of expired) await prisma.salesBonus.update({ where: { id: b.id }, data: { status: 'WITHHELD', withheldReason: 'KPI_DEADLINE_PASSED' } });
  return expired.length;
}

/** Выплата бонусов: финансы отмечают PAYABLE → PAID c периодом и ссылкой на ведомость (без автопроводки в зарплату). */
export async function markBonusesPaid(ctx: TenantContext, ids: string[], payoutPeriod: string, payoutRef?: string | null, now = new Date()): Promise<number> {
  requirePermission(ctx, 'bonus.pay');
  if (!/^\d{4}-\d{2}$/.test(payoutPeriod)) throw new ValidationError('PERIOD_INVALID', 'PERIOD_INVALID: формат YYYY-MM');
  let n = 0;
  for (const id of ids) {
    await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
      const b = await findScopedOr404(tx.salesBonus, ctx, id);
      if (b.status !== 'PAYABLE') throw new ValidationError('BONUS_NOT_PAYABLE', `BONUS_NOT_PAYABLE: ${b.id} в статусе ${b.status}`);
      const after = await tx.salesBonus.update({ where: { id }, data: { status: 'PAID', paidAt: now, payoutPeriod, payoutRef: payoutRef ?? null } });
      return { result: after, audit: { action: 'sales_bonus.pay', objectType: 'sales_bonus', objectId: id, before: pickB(b), after: { ...pickB(after), payoutPeriod, payoutRef: payoutRef ?? null } } };
    });
    n++;
  }
  return n;
}

// ── Чтение ──

export interface CommissionRow extends Commission {
  dealNumber: string;
  unitNo: string | null;
  managerName: string;
  outstandingMinor: bigint;
}

export async function listCommissions(ctx: TenantContext, filter: { status?: Commission['status'][]; dealId?: string } = {}): Promise<CommissionRow[]> {
  requirePermission(ctx, 'commission.view');
  const where: Prisma.CommissionWhereInput = { tenantId: ctx.tenantId, ...(filter.status ? { status: { in: filter.status } } : {}), ...(filter.dealId ? { dealId: filter.dealId } : {}) };
  const rows = await prisma.commission.findMany({ where, include: { deal: { select: { number: true, managerId: true, unit: { select: { unitNo: true } } } } }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }] });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.deal.managerId))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return rows.map(({ deal, ...c }) => ({ ...c, dealNumber: deal.number, unitNo: deal.unit?.unitNo ?? null, managerName: users.get(deal.managerId) ?? '—', outstandingMinor: c.status === 'CANCELLED' || c.status === 'PAID' ? 0n : c.amountMinor - c.receivedMinor }));
}

export interface BonusRow extends SalesBonus {
  employeeName: string;
  dealNumber: string;
  product: DealProduct;
  unitNo: string | null;
  commissionStatus: Commission['status'];
}

/** bonus.view — все; bonus.own — только свои (BROKER/COMMERCIAL_MANAGER без bonus.view). */
export async function listBonuses(ctx: TenantContext, filter: { employeeId?: string; status?: BonusStatus[]; period?: string } = {}): Promise<BonusRow[]> {
  const all = can(ctx, 'bonus.view');
  if (!all) requirePermission(ctx, 'bonus.own');
  const where: Prisma.SalesBonusWhereInput = { tenantId: ctx.tenantId, ...(all ? (filter.employeeId ? { employeeId: filter.employeeId } : {}) : { employeeId: ctx.userId }), ...(filter.status ? { status: { in: filter.status } } : {}) };
  if (filter.period) {
    const [y, m] = filter.period.split('-').map(Number);
    const from = new Date(Date.UTC(y!, m! - 1, 1)); const to = new Date(Date.UTC(y!, m!, 1));
    where.OR = [{ payoutPeriod: filter.period }, { payableAt: { gte: from, lt: to } }, { createdAt: { gte: from, lt: to }, status: { in: ['POTENTIAL', 'CONFIRMED', 'WITHHELD'] } }];
  }
  const rows = await prisma.salesBonus.findMany({ where, include: { deal: { select: { number: true, product: true, unit: { select: { unitNo: true } } } }, commission: { select: { status: true } } }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return rows.map(({ deal, commission, ...b }) => ({ ...b, employeeName: users.get(b.employeeId) ?? '—', dealNumber: deal.number, product: deal.product, unitNo: deal.unit?.unitNo ?? null, commissionStatus: commission.status }));
}

export interface BonusReportLine { employeeId: string; employeeName: string; potentialMinor: bigint; confirmedMinor: bigint; payableMinor: bigint; paidMinor: bigint; withheldMinor: bigint; deals: number }

/** Отчёт по сотрудникам за период (для бухгалтерии, без автопроводки в зарплату). */
export async function getBonusReport(ctx: TenantContext, period: string): Promise<{ lines: BonusReportLine[]; currency: string; totals: Omit<BonusReportLine, 'employeeId' | 'employeeName'> }> {
  const rows = await listBonuses(ctx, { period });
  const by = new Map<string, BonusReportLine>();
  const dealsBy = new Map<string, Set<string>>();
  for (const b of rows) {
    const l = by.get(b.employeeId) ?? { employeeId: b.employeeId, employeeName: b.employeeName, potentialMinor: 0n, confirmedMinor: 0n, payableMinor: 0n, paidMinor: 0n, withheldMinor: 0n, deals: 0 };
    const key = ({ POTENTIAL: 'potentialMinor', CONFIRMED: 'confirmedMinor', PAYABLE: 'payableMinor', PAID: 'paidMinor', WITHHELD: 'withheldMinor' } as const)[b.status];
    l[key] += b.amountMinor;
    dealsBy.set(b.employeeId, (dealsBy.get(b.employeeId) ?? new Set()).add(b.dealId));
    by.set(b.employeeId, l);
  }
  const lines = [...by.values()].map((l) => ({ ...l, deals: dealsBy.get(l.employeeId)?.size ?? 0 })).sort((a, b) => Number(b.payableMinor + b.paidMinor - a.payableMinor - a.paidMinor));
  const totals = lines.reduce((t, l) => ({ potentialMinor: t.potentialMinor + l.potentialMinor, confirmedMinor: t.confirmedMinor + l.confirmedMinor, payableMinor: t.payableMinor + l.payableMinor, paidMinor: t.paidMinor + l.paidMinor, withheldMinor: t.withheldMinor + l.withheldMinor, deals: t.deals + l.deals }), { potentialMinor: 0n, confirmedMinor: 0n, payableMinor: 0n, paidMinor: 0n, withheldMinor: 0n, deals: 0 });
  return { lines, currency: rows[0]?.currency ?? 'USD', totals };
}

/** Блок «Комиссия и бонус» карточки сделки. */
export async function getDealCommission(ctx: TenantContext, dealId: string) {
  const commission = can(ctx, 'commission.view') || can(ctx, 'bonus.own') ? await prisma.commission.findFirst({ where: whereTenant(ctx, { dealId }) }) : null;
  const bonuses = commission ? await listBonuses(ctx, {}).then((rows) => rows.filter((b) => b.dealId === dealId)).catch(() => [] as BonusRow[]) : [];
  const checklist = await prisma.dealChecklistItem.findMany({ where: whereTenant(ctx, { dealId }), orderBy: { item: 'asc' } });
  const doneBy = new Map((await prisma.user.findMany({ where: { id: { in: checklist.map((c) => c.doneBy).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const kpi = bonuses.find((b) => b.kind === 'KPI') ?? null;
  return {
    commission: can(ctx, 'commission.view') ? commission : null,
    bonuses,
    checklist: checklist.map((c) => ({ ...c, doneByName: c.doneBy ? (doneBy.get(c.doneBy) ?? '—') : null })),
    kpi: kpi ? { status: kpi.status, deadline: kpi.kpiDeadline, confirmedAt: kpi.kpiConfirmedAt } : null,
    can: { checklist: can(ctx, 'deal.checklist') && !kpi?.kpiConfirmedAt && kpi?.status !== 'WITHHELD', confirmKpi: can(ctx, 'bonus.confirm_kpi') && !!kpi && !kpi.kpiConfirmedAt && kpi.status !== 'WITHHELD' },
  };
}
