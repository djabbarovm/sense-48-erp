import type { BusinessUnit, EventFormat } from '@prisma/client';
import { requirePermission, type TenantContext } from '@finance-os/core';
import { prisma } from '../client.js';
import { getCashPosition } from './bank.js';
import { getArAging } from './arInvoices.js';

/**
 * H-07 (ADR-013): расчёты окна «Утро» по docs/15-ceo-path.md.
 * Все выводы детерминированные; формулы v1 зафиксированы в комментариях.
 * Выручка факт Rooftop = события, которые состоялись (HELD и дальше) в периоде;
 * подтверждённая будущая = CONFIRMED/IN_PROGRESS до конца периода.
 * Маржа события = выручка × (1 − норматив себестоимости формата).
 * «Фактически прошли БУ» — накопленная маржа состоявшегося ≥ пост. расходов;
 * «по прогнозу» — то же с учётом подтверждённого будущего.
 */

const DEFAULT_COST_PCT: Record<EventFormat, number> = { BANQUET: 35, CONFERENCE: 20, PRIVATE: 30, PUBLIC: 30 };

export interface BreakEven {
  unit: BusinessUnit;
  period: string;
  fixedMinor: bigint;
  fixedFilled: boolean;
  revenueActualMinor: bigint;
  marginActualMinor: bigint;
  revenueConfirmedFutureMinor: bigint;
  marginForecastMinor: bigint;
  requiredRevenueMinor: bigint; // fixed / (1 − средний норматив)
  progressPct: number; // маржа факт / fixed
  passedFact: boolean;
  passedForecast: boolean;
  passDateForecast: Date | null; // день события, на котором накопленная маржа покрывает fixed
  profitForecastMinor: bigint; // маржа прогноз − fixed
  senseMembershipShare: number | null;
}

const monthRange = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return { from: new Date(Date.UTC(y!, m! - 1, 1)), to: new Date(Date.UTC(y!, m!, 1)) };
};

async function norms(tenantId: string): Promise<Record<EventFormat, number>> {
  const rows = await prisma.costNorm.findMany({ where: { tenantId } });
  const out = { ...DEFAULT_COST_PCT };
  for (const r of rows) out[r.format] = r.costPct;
  return out;
}

export async function getBreakEven(ctx: TenantContext, unit: BusinessUnit, period: string, now = new Date()): Promise<BreakEven> {
  requirePermission(ctx, 'dashboard.owner');
  const t = ctx.tenantId;
  const { from, to } = monthRange(period);
  const fixed = await prisma.fixedCost.aggregate({ where: { tenantId: t, unit, period }, _sum: { amountMinor: true }, _count: true });
  const fixedMinor = fixed._sum.amountMinor ?? 0n;
  const nn = await norms(t);
  const margin = (rev: bigint, format: EventFormat) => (rev * BigInt(100 - (nn[format] ?? 30))) / 100n;

  let revenueActual = 0n;
  let marginActual = 0n;
  let revenueFuture = 0n;
  const futureByDate: { date: Date; marginMinor: bigint }[] = [];

  if (unit === 'ROOFTOP') {
    const events = await prisma.event.findMany({
      where: { tenantId: t, eventDate: { gte: from, lt: to }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
    });
    for (const e of events) {
      const m = margin(e.revenueBudgetMinor, e.format);
      if (['HELD', 'SETTLING', 'CLOSED'].includes(e.status) || (e.eventDate < now && e.status === 'IN_PROGRESS')) {
        revenueActual += e.revenueBudgetMinor;
        marginActual += m;
      } else if (['CONFIRMED', 'IN_PROGRESS'].includes(e.status)) {
        revenueFuture += e.revenueBudgetMinor;
        futureByDate.push({ date: e.eventDate, marginMinor: m });
      }
    }
  } else {
    // Sense: факт из дневных сводок; будущее v1 не прогнозируем (появится c Altegio)
    const stats = await prisma.senseDailyStat.findMany({ where: { tenantId: t, date: { gte: from, lt: to } } });
    for (const s of stats) {
      revenueActual += s.revenueMinor;
      marginActual += (s.revenueMinor * BigInt(100 - (nn.PRIVATE ?? 30))) / 100n;
    }
  }

  const marginForecast = marginActual + futureByDate.reduce((s, f) => s + f.marginMinor, 0n);
  const avgNorm = unit === 'ROOFTOP' ? nn.BANQUET : nn.PRIVATE;
  const requiredRevenue = fixedMinor > 0n ? (fixedMinor * 100n) / BigInt(100 - avgNorm) : 0n;

  let passDate: Date | null = null;
  if (fixedMinor > 0n) {
    if (marginActual >= fixedMinor) passDate = now;
    else {
      let acc = marginActual;
      for (const f of futureByDate.sort((a, b) => a.date.getTime() - b.date.getTime())) {
        acc += f.marginMinor;
        if (acc >= fixedMinor) { passDate = f.date; break; }
      }
    }
  }

  let senseMembershipShare: number | null = null;
  if (unit === 'SENSE48') senseMembershipShare = null; // v1: появится c разбивкой Altegio

  return {
    unit, period, fixedMinor, fixedFilled: fixed._count > 0,
    revenueActualMinor: revenueActual, marginActualMinor: marginActual,
    revenueConfirmedFutureMinor: revenueFuture, marginForecastMinor: marginForecast,
    requiredRevenueMinor: requiredRevenue,
    progressPct: fixedMinor > 0n ? Number((marginActual * 100n) / fixedMinor) : 0,
    passedFact: fixedMinor > 0n && marginActual >= fixedMinor,
    passedForecast: fixedMinor > 0n && marginForecast >= fixedMinor,
    passDateForecast: passDate,
    profitForecastMinor: marginForecast - fixedMinor,
    senseMembershipShare,
  };
}

export interface Occupancy {
  monthBusy: number; monthDays: number; monthBusyAhead: number; monthDaysAhead: number;
  confirmed30: number; confirmed60: number; confirmed90: number;
  prelim30: number;
  freeSellable30: number;
  moneyLoadMinor: bigint; // подтверждённая выручка будущих событий (90 дн)
}

export async function getOccupancy(ctx: TenantContext, now = new Date()): Promise<Occupancy> {
  requirePermission(ctx, 'dashboard.owner');
  const t = ctx.tenantId;
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const in90 = new Date(now.getTime() + 90 * 86400_000);
  const monthFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const events = await prisma.event.findMany({
    where: { tenantId: t, eventDate: { gte: monthFrom, lt: in90 }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
  });
  const confirmedSet = new Set<string>(); const prelimSet = new Set<string>();
  let moneyLoad = 0n;
  let c30 = 0, c60 = 0, c90 = 0, p30 = 0;
  for (const e of events) {
    const confirmed = !['QUOTED'].includes(e.status);
    const dd = day(e.eventDate);
    (confirmed ? confirmedSet : prelimSet).add(dd);
    const daysAhead = (e.eventDate.getTime() - now.getTime()) / 86400_000;
    if (e.eventDate >= now && confirmed) {
      moneyLoad += e.revenueBudgetMinor;
      if (daysAhead <= 30) c30++;
      if (daysAhead <= 60) c60++;
      if (daysAhead <= 90) c90++;
    }
    if (e.eventDate >= now && !confirmed && daysAhead <= 30) p30++;
  }
  const monthDays = Math.round((monthTo.getTime() - monthFrom.getTime()) / 86400_000);
  const todayDate = now.getUTCDate();
  const monthBusy = [...confirmedSet, ...prelimSet].filter((d) => d >= day(monthFrom) && d < day(monthTo)).length;
  const busyAhead = [...confirmedSet, ...prelimSet].filter((d) => d >= day(now) && d < day(monthTo)).length;
  // v1: продаваемыми считаем все календарные дни; конфиг календаря — этап 2
  return {
    monthBusy, monthDays, monthBusyAhead: busyAhead, monthDaysAhead: monthDays - todayDate + 1,
    confirmed30: c30, confirmed60: c60, confirmed90: c90, prelim30: p30,
    freeSellable30: Math.max(0, 30 - [...confirmedSet, ...prelimSet].filter((d) => d >= day(now) && new Date(d) <= new Date(now.getTime() + 30 * 86400_000)).length),
    moneyLoadMinor: moneyLoad,
  };
}

export interface CeoDecision {
  kind: 'BATCH' | 'PR' | 'EXCEPTION' | 'DEBT';
  what: string;
  impactMinor: bigint;
  deadline: string | null;
  recommendation: string;
  owner: string | null;
  href: string;
}

export async function getCeoDecisions(ctx: TenantContext): Promise<CeoDecision[]> {
  requirePermission(ctx, 'dashboard.owner');
  const t = ctx.tenantId;
  const out: CeoDecision[] = [];
  const batches = await prisma.paymentBatch.findMany({ where: { tenantId: t, status: 'FROZEN' } });
  for (const b of batches) {
    const sum = await prisma.paymentRequest.aggregate({ where: { batchId: b.id }, _sum: { requestedMinor: true }, _count: true });
    out.push({
      kind: 'BATCH', what: `Батч ${b.number}: ${sum._count} платежей ждут одобрения`,
      impactMinor: sum._sum.requestedMinor ?? 0n, deadline: 'сегодня',
      recommendation: 'Проверить exceptions внутри и одобрить до cutoff', owner: null, href: `/batches/${b.id}`,
    });
  }
  const prs = await prisma.purchaseApproval.findMany({
    where: { tenantId: t, decision: null, role: 'OWNER', pr: { status: { in: ['SUBMITTED', 'APPROVED'] } } },
    include: { pr: true },
    take: 5,
  });
  for (const a of prs) {
    const pr = a.pr;
    if (pr.status !== 'SUBMITTED') continue;
    out.push({
      kind: 'PR', what: `Заявка ${pr.number}: ${pr.what}`, impactMinor: pr.totalMinor,
      deadline: null, recommendation: pr.purpose, owner: null, href: '/approvals',
    });
  }
  const holds = await prisma.paymentRequest.findMany({ where: { tenantId: t, status: 'ON_HOLD' }, take: 5 });
  for (const p of holds) {
    out.push({
      kind: 'EXCEPTION', what: `Платёж ${p.number} на блоке`, impactMinor: p.requestedMinor,
      deadline: null, recommendation: p.purposeNote || 'Разобрать причину блокировки', owner: null, href: '/approvals',
    });
  }
  return out;
}

export interface MorningView {
  period: string;
  summary: string[];
  rooftop: BreakEven;
  sense: BreakEven;
  occupancy: Occupancy;
  nearestEvent: Awaited<ReturnType<typeof nearestEvent>>;
  week: { events: number; guests: number; revenueMinor: bigint; risks: number };
  senseToday: { stat: { visitsPlanned: number | null; loadPct: number | null; revenueMinor: bigint; cancellations: number; notes: string | null } | null };
  money: {
    accounts: { name: string; balanceMinor: bigint }[];
    totalMinor: bigint;
    due7Minor: bigint;
    expectedInMinor: bigint;
    freeMinor: bigint;
    topOverdueAr: { name: string; amountMinor: bigint }[];
  };
  decisions: CeoDecision[];
}

async function nearestEvent(tenantId: string, now: Date) {
  const e = await prisma.event.findFirst({
    where: { tenantId, eventDate: { gte: now }, status: { notIn: ['DRAFT', 'CANCELLED', 'CLOSED'] } },
    orderBy: { eventDate: 'asc' },
  });
  if (!e) return null;
  const customer = e.customerId ? await prisma.customer.findUnique({ where: { id: e.customerId } }) : null;
  const owner = e.ownerId ? await prisma.user.findUnique({ where: { id: e.ownerId } }) : null;
  const deposits = await prisma.customerInvoice.aggregate({ where: { tenantId, eventId: e.id }, _sum: { receivedMinor: true } });
  const received = deposits._sum.receivedMinor ?? 0n;
  const openTasks = await prisma.task.count({ where: { tenantId, objectType: 'event', objectId: e.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
  return {
    id: e.id, name: e.name, date: e.eventDate, startTime: e.startTime, format: e.format,
    customerName: customer?.legalName ?? null, guests: e.guestsPlanned,
    contractMinor: e.revenueBudgetMinor, depositMinor: received, restMinor: e.revenueBudgetMinor - received,
    ownerName: owner?.fullName ?? null, riskNote: e.riskNote, status: e.status, openTasks,
  };
}

export async function getMorning(ctx: TenantContext, now = new Date()): Promise<MorningView> {
  requirePermission(ctx, 'dashboard.owner');
  const t = ctx.tenantId;
  const period = now.toISOString().slice(0, 7);
  const [rooftop, sense, occupancy, near, decisions, cash, ar] = await Promise.all([
    getBreakEven(ctx, 'ROOFTOP', period, now),
    getBreakEven(ctx, 'SENSE48', period, now),
    getOccupancy(ctx, now),
    nearestEvent(t, now),
    getCeoDecisions(ctx),
    getCashPosition(ctx),
    getArAging(ctx, now),
  ]);

  const in7 = new Date(now.getTime() + 7 * 86400_000);
  const weekEvents = await prisma.event.findMany({
    where: { tenantId: t, eventDate: { gte: now, lt: in7 }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
  });
  const week = {
    events: weekEvents.length,
    guests: weekEvents.reduce((s, e) => s + (e.guestsPlanned ?? 0), 0),
    revenueMinor: weekEvents.reduce((s, e) => s + e.revenueBudgetMinor, 0n),
    risks: weekEvents.filter((e) => e.riskNote || e.status === 'QUOTED').length,
  };

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const senseStat = await prisma.senseDailyStat.findFirst({ where: { tenantId: t, date: today } });

  const due7 = await prisma.paymentRequest.aggregate({
    where: { tenantId: t, status: { in: ['READY_FOR_BATCH', 'IN_BATCH', 'SENT_TO_BANK'] } },
    _sum: { requestedMinor: true },
  });
  const expectedIn = await prisma.customerInvoice.aggregate({
    where: { tenantId: t, status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueDate: { lte: in7 } },
    _sum: { amountGrossMinor: true },
  });
  const overdue = ar
    .map((r) => ({ name: r.customerName, amountMinor: r.buckets.D60_PLUS + r.buckets.D31_60 + r.buckets.D8_30 + r.buckets.D1_7 }))
    .filter((r) => r.amountMinor > 0n)
    .sort((a, b) => (b.amountMinor > a.amountMinor ? 1 : -1))
    .slice(0, 3);

  const total = cash.reduce((s, a) => s + a.balanceMinor, 0n);
  const due7m = due7._sum.requestedMinor ?? 0n;
  const money = {
    accounts: cash.map((a) => ({ name: `${a.account.bankName} ${a.account.accountMasked}`, balanceMinor: a.balanceMinor })),
    totalMinor: total,
    due7Minor: due7m,
    expectedInMinor: expectedIn._sum.amountGrossMinor ?? 0n,
    freeMinor: total - due7m,
    topOverdueAr: overdue,
  };

  // ── «Итог одной строкой»: детерминированные правила ──
  const fmtM = (m: bigint) => `${(m / 100_000_000n).toLocaleString('ru-RU')} млн`;
  const summary: string[] = [];
  if (!rooftop.fixedFilled) summary.push('Rooftop: заполните постоянные расходы месяца — без них точка безубыточности не считается.');
  else if (rooftop.passedFact) summary.push('Rooftop прошёл точку безубыточности — дальше каждый банкет работает в прибыль.');
  else if (rooftop.passedForecast && rooftop.passDateForecast)
    summary.push(`Rooftop пока не прошёл точку безубыточности, но пройдёт ${rooftop.passDateForecast.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} при сохранении подтверждённых мероприятий.`);
  else summary.push(`Rooftop не проходит безубыточность по текущим продажам — не хватает ${fmtM(rooftop.fixedMinor - rooftop.marginForecastMinor)} маржи до конца месяца.`);
  if (!sense.fixedFilled) summary.push('Sense: заполните постоянные расходы.');
  else summary.push(sense.passedFact ? 'Sense идёт по плану.' : `Sense: маржа покрыла ${sense.progressPct}% постоянных расходов.`);
  if (overdue[0] && overdue[0].amountMinor > total / 2n) summary.push(`Главный риск — дебиторка: ${overdue[0].name} должен ${fmtM(overdue[0].amountMinor)}.`);
  summary.push(decisions.length === 0 ? 'Решений от вас сегодня не требуется.' : `Сегодня нужно принять ${decisions.length} решени${decisions.length === 1 ? 'е' : decisions.length < 5 ? 'я' : 'й'}.`);

  return { period, summary, rooftop, sense, occupancy, nearestEvent: near, week, senseToday: { stat: senseStat ? { visitsPlanned: senseStat.visitsPlanned, loadPct: senseStat.loadPct, revenueMinor: senseStat.revenueMinor, cancellations: senseStat.cancellations, notes: senseStat.notes } : null }, money, decisions };
}

/* ── справочники ── */

export async function upsertFixedCost(ctx: TenantContext, input: { unit: BusinessUnit; period: string; name: string; amountMinor: bigint }) {
  requirePermission(ctx, 'budget.manage');
  return prisma.fixedCost.upsert({
    where: { tenantId_unit_period_name: { tenantId: ctx.tenantId, unit: input.unit, period: input.period, name: input.name } },
    create: { tenantId: ctx.tenantId, ...input, updatedBy: ctx.userId },
    update: { amountMinor: input.amountMinor, updatedBy: ctx.userId },
  });
}
export async function listFixedCosts(ctx: TenantContext, period: string) {
  requirePermission(ctx, 'budget.manage');
  return prisma.fixedCost.findMany({ where: { tenantId: ctx.tenantId, period }, orderBy: [{ unit: 'asc' }, { name: 'asc' }] });
}
export async function deleteFixedCost(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'budget.manage');
  await prisma.fixedCost.deleteMany({ where: { tenantId: ctx.tenantId, id } });
}
export async function upsertCostNorm(ctx: TenantContext, format: EventFormat, costPct: number) {
  requirePermission(ctx, 'budget.manage');
  if (costPct < 0 || costPct > 95) throw new Error('Норматив себестоимости: 0–95%');
  return prisma.costNorm.upsert({
    where: { tenantId_format: { tenantId: ctx.tenantId, format } },
    create: { tenantId: ctx.tenantId, format, costPct },
    update: { costPct },
  });
}
export async function listCostNorms(ctx: TenantContext) {
  requirePermission(ctx, 'budget.manage');
  const rows = await prisma.costNorm.findMany({ where: { tenantId: ctx.tenantId } });
  return (Object.keys(DEFAULT_COST_PCT) as EventFormat[]).map((format) => ({
    format, costPct: rows.find((r) => r.format === format)?.costPct ?? DEFAULT_COST_PCT[format], isDefault: !rows.some((r) => r.format === format),
  }));
}
export async function upsertSenseDay(ctx: TenantContext, input: { date: Date; visitsPlanned?: number; visitsActual?: number; revenueMinor: bigint; loadPct?: number; cancellations?: number; membershipsSold?: number; notes?: string }) {
  requirePermission(ctx, 'ar.invoice.manage');
  const { date, ...rest } = input;
  return prisma.senseDailyStat.upsert({
    where: { tenantId_date: { tenantId: ctx.tenantId, date } },
    create: { tenantId: ctx.tenantId, date, ...rest, updatedBy: ctx.userId },
    update: { ...rest, updatedBy: ctx.userId },
  });
}
