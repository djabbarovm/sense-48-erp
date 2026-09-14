/**
 * D-04: 13-week cash forecast (docs/08).
 * opening (cash position) + expected AR + committed payments/PR + CashPlanLine
 * (расписание capex/loan, recurrence MONTHLY) → weekly table.
 * Точность прогноза фиксируется в CashForecastSnapshot.
 */
import type { TenantContext } from '@finance-os/core';
import { ValidationError, requirePermission } from '@finance-os/core';
import type { CashPlanType } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { whereTenant } from '../repository.js';

const WEEK_MS = 7 * 86400_000;

/** Понедельник недели, содержащей date (UTC). */
export function weekStartOf(date: Date): Date {
  const day = date.getUTCDay(); // 0=вс
  const shift = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - shift));
  return monday;
}

export interface ForecastWeek {
  weekStart: Date;
  inflowArMinor: bigint;
  inflowPlanMinor: bigint;
  outflowPaymentsMinor: bigint;
  outflowPrMinor: bigint;
  outflowPlanMinor: bigint;
  netMinor: bigint;
  closingMinor: bigint;
}

export interface CashForecast {
  openingMinor: bigint;
  weeks: ForecastWeek[];
}

const PAY_COMMITTED = ['READY_FOR_BATCH', 'IN_BATCH', 'APPROVED', 'SENT_TO_BANK'] as const;

export async function getCashForecast(ctx: TenantContext, now = new Date(), weeksCount = 13): Promise<CashForecast> {
  requirePermission(ctx, 'payment.view');
  const start = weekStartOf(now);
  const horizon = new Date(start.getTime() + weeksCount * WEEK_MS);

  const [accounts, txAgg, arInvoices, payments, approvedPrs, planLines] = await Promise.all([
    prisma.bankAccount.findMany({ where: whereTenant(ctx, { isActive: true }) }),
    prisma.bankTransaction.groupBy({
      by: ['bankAccountId'],
      where: { tenantId: ctx.tenantId },
      _sum: { amountMinor: true },
    }),
    prisma.customerInvoice.findMany({
      where: whereTenant(ctx, { status: { in: ['ISSUED' as const, 'PARTIALLY_PAID' as const, 'OVERDUE' as const] } }),
    }),
    prisma.paymentRequest.findMany({ where: whereTenant(ctx, { status: { in: [...PAY_COMMITTED] } }) }),
    prisma.purchaseRequest.findMany({
      where: whereTenant(ctx, { status: { in: ['APPROVED' as const, 'ORDERED' as const, 'RECEIVED' as const] } }),
    }),
    prisma.cashPlanLine.findMany({ where: whereTenant(ctx) }),
  ]);

  const txByAccount = new Map(txAgg.map((t) => [t.bankAccountId, t._sum.amountMinor ?? 0n]));
  // мультивалютные счета: в forecast входит только базовая валюта (UZS) — FX-эквивалент в Phase F
  const opening = accounts
    .filter((a) => a.currency === 'UZS')
    .reduce((sum, a) => sum + a.openingBalanceMinor + (txByAccount.get(a.id) ?? 0n), 0n);

  const weeks: ForecastWeek[] = Array.from({ length: weeksCount }, (_, i) => ({
    weekStart: new Date(start.getTime() + i * WEEK_MS),
    inflowArMinor: 0n,
    inflowPlanMinor: 0n,
    outflowPaymentsMinor: 0n,
    outflowPrMinor: 0n,
    outflowPlanMinor: 0n,
    netMinor: 0n,
    closingMinor: 0n,
  }));
  const weekIndex = (date: Date): number => {
    if (date < start) return 0; // просроченное — в текущую неделю
    const i = Math.floor((weekStartOf(date).getTime() - start.getTime()) / WEEK_MS);
    return i >= weeksCount ? -1 : i;
  };

  // AR: promise-to-pay важнее due_date
  for (const invoice of arInvoices) {
    const expected = invoice.promiseToPayDate ?? invoice.dueDate;
    const i = weekIndex(expected);
    if (i >= 0) weeks[i]!.inflowArMinor += invoice.amountGrossMinor - invoice.receivedMinor;
  }
  // Обязательства по платежам
  for (const payment of payments) {
    const i = weekIndex(payment.dueDate ?? now);
    if (i >= 0) weeks[i]!.outflowPaymentsMinor += payment.requestedMinor;
  }
  // Approved PR без платежей — по needed_by
  const prIdsWithPayments = new Set(
    (
      await prisma.paymentRequest.findMany({
        where: { tenantId: ctx.tenantId, sourceType: 'PR', sourceId: { in: approvedPrs.map((p) => p.id) } },
        select: { sourceId: true },
      })
    ).map((p) => p.sourceId),
  );
  for (const pr of approvedPrs) {
    if (prIdsWithPayments.has(pr.id)) continue;
    const i = weekIndex(pr.neededBy ?? now);
    if (i >= 0) weeks[i]!.outflowPrMinor += pr.totalMinor;
  }
  // CashPlanLine: разовые и MONTHLY в горизонте
  for (const line of planLines) {
    const dates: Date[] = [];
    if (line.recurrence === 'MONTHLY') {
      const cursor = new Date(line.dueDate);
      while (cursor < horizon) {
        if (cursor >= start || cursor >= now) dates.push(new Date(cursor));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    } else {
      dates.push(line.dueDate);
    }
    for (const date of dates) {
      const i = weekIndex(date);
      if (i < 0) continue;
      if (line.amountMinor >= 0n) weeks[i]!.inflowPlanMinor += line.amountMinor;
      else weeks[i]!.outflowPlanMinor += -line.amountMinor;
    }
  }

  let running = opening;
  for (const week of weeks) {
    week.netMinor =
      week.inflowArMinor + week.inflowPlanMinor - week.outflowPaymentsMinor - week.outflowPrMinor - week.outflowPlanMinor;
    running += week.netMinor;
    week.closingMinor = running;
  }
  return { openingMinor: opening, weeks };
}

// ── CashPlanLine CRUD ──

export async function upsertCashPlanLine(
  ctx: TenantContext,
  input: { id?: string; name: string; type?: CashPlanType; amountMinor: bigint; dueDate: Date; recurrence?: 'MONTHLY' | null },
) {
  requirePermission(ctx, 'budget.manage');
  if (input.amountMinor === 0n) throw new ValidationError('AMOUNT_INVALID');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const data = {
      name: input.name,
      type: input.type ?? 'OTHER',
      amountMinor: input.amountMinor,
      dueDate: input.dueDate,
      recurrence: input.recurrence ?? null,
    };
    if (input.id) {
      const existing = await tx.cashPlanLine.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
      if (!existing) throw new ValidationError('NOT_FOUND');
    }
    const line = input.id
      ? await tx.cashPlanLine.update({ where: { id: input.id }, data })
      : await tx.cashPlanLine.create({ data: { tenantId: ctx.tenantId, ...data, createdBy: ctx.userId } });
    return {
      result: line,
      audit: {
        action: 'cash_plan.upsert',
        objectType: 'cash_plan_line',
        objectId: line.id,
        after: { name: input.name, amountMinor: input.amountMinor.toString(), recurrence: input.recurrence ?? null },
      },
    };
  });
}

export async function deleteCashPlanLine(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'budget.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const line = await tx.cashPlanLine.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!line) throw new ValidationError('NOT_FOUND');
    await tx.cashPlanLine.delete({ where: { id } });
    return {
      result: line,
      audit: { action: 'cash_plan.delete', objectType: 'cash_plan_line', objectId: id, before: { name: line.name } },
    };
  });
}

export async function listCashPlanLines(ctx: TenantContext) {
  requirePermission(ctx, 'payment.view');
  return prisma.cashPlanLine.findMany({ where: whereTenant(ctx), orderBy: { dueDate: 'asc' } });
}

// ── Snapshot / accuracy (D-04) ──

/** Job (D-05): фиксирует прогноз закрытия текущей недели; факт дозаписывается позже. */
export async function snapshotForecast(tenantId: string, now = new Date()): Promise<void> {
  const ctx = { tenantId, tenantSlug: '', userId: null, roles: ['OWNER'] } as unknown as TenantContext;
  const forecast = await getCashForecast(ctx, now, 1);
  const weekStart = weekStartOf(now);
  await prisma.cashForecastSnapshot.upsert({
    where: { tenantId_weekStart: { tenantId, weekStart } },
    create: { tenantId, weekStart, forecastMinor: forecast.weeks[0]!.closingMinor },
    update: {}, // прогноз фиксируется один раз — первым запуском недели
  });
  // факт для прошедших недель: cash position на конец недели
  const past = await prisma.cashForecastSnapshot.findMany({
    where: { tenantId, actualMinor: null, weekStart: { lt: new Date(weekStart.getTime() - 1) } },
  });
  for (const snap of past) {
    const weekEnd = new Date(snap.weekStart.getTime() + WEEK_MS);
    const accounts = await prisma.bankAccount.findMany({ where: { tenantId, isActive: true, currency: 'UZS' } });
    let actual = 0n;
    for (const account of accounts) {
      const agg = await prisma.bankTransaction.aggregate({
        where: { bankAccountId: account.id, bookingDate: { lt: weekEnd } },
        _sum: { amountMinor: true },
      });
      actual += account.openingBalanceMinor + (agg._sum.amountMinor ?? 0n);
    }
    await prisma.cashForecastSnapshot.update({ where: { id: snap.id }, data: { actualMinor: actual } });
  }
}
