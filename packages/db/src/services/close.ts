/**
 * F-03: Close Center — чеклист закрытия месяца + данные для month-end pack.
 * XLSX собирает adapters/buildMonthEndPackXlsx; PDF-резюме — печатная страница.
 */
import type { TenantContext } from '@finance-os/core';
import { requirePermission } from '@finance-os/core';
import { prisma } from '../client.js';
import { getApAging } from './aging.js';
import { getArAging } from './arInvoices.js';
import { getCashForecast } from './forecast.js';
import { getDocumentHealth, HEALTH_ZONES } from './documentHealth.js';
import { listBudgetMatrix } from './budgets.js';

export interface CloseChecklistRow {
  key: string;
  ok: boolean;
  count: number;
  href: string;
}

function periodRange(period: string): { from: Date; to: Date } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

export async function getCloseChecklist(ctx: TenantContext, period: string): Promise<CloseChecklistRow[]> {
  requirePermission(ctx, 'close.run');
  const t = ctx.tenantId;
  const { from, to } = periodRange(period);

  const [unmatchedTx, inflightPayments, unmatchedInvoices, arOverdue, taxesOpen, payroll, openEvents, health, holds] =
    await Promise.all([
      prisma.bankTransaction.count({ where: { tenantId: t, matchStatus: { in: ['UNMATCHED', 'SUGGESTED'] as const } } }),
      prisma.paymentRequest.count({
        where: { tenantId: t, status: { in: ['IN_BATCH', 'APPROVED', 'SENT_TO_BANK'] as const }, createdAt: { lt: to } },
      }),
      prisma.invoice.count({ where: { tenantId: t, matchStatus: 'UNMATCHED', status: 'RECEIVED', date: { lt: to } } }),
      prisma.customerInvoice.count({ where: { tenantId: t, status: 'OVERDUE' } }),
      prisma.taxObligation.count({ where: { tenantId: t, period, status: { notIn: ['FILED'] as const } } }),
      prisma.payrollRun.findUnique({ where: { tenantId_period: { tenantId: t, period } } }),
      prisma.event.count({
        where: { tenantId: t, eventDate: { gte: from, lt: to }, status: { notIn: ['CLOSED', 'CANCELLED'] as const } },
      }),
      getDocumentHealth(ctx),
      prisma.paymentRequest.count({ where: { tenantId: t, status: 'ON_HOLD' } }),
    ]);
  const docIssues = HEALTH_ZONES.reduce((sum, zone) => sum + health[zone].length, 0);

  return [
    { key: 'bank', ok: unmatchedTx === 0, count: unmatchedTx, href: '/bank' },
    { key: 'payments', ok: inflightPayments === 0, count: inflightPayments, href: '/payments' },
    { key: 'holds', ok: holds === 0, count: holds, href: '/payments' },
    { key: 'invoices', ok: unmatchedInvoices === 0, count: unmatchedInvoices, href: '/invoices' },
    { key: 'ar', ok: arOverdue === 0, count: arOverdue, href: '/ar' },
    { key: 'taxes', ok: taxesOpen === 0, count: taxesOpen, href: '/tax' },
    { key: 'payroll', ok: payroll?.status === 'POSTED', count: payroll ? (payroll.status === 'POSTED' ? 0 : 1) : 1, href: '/payroll' },
    { key: 'events', ok: openEvents === 0, count: openEvents, href: '/events' },
    { key: 'documents', ok: docIssues === 0, count: docIssues, href: '/documents/health' },
  ];
}

export interface MonthEndPackData {
  period: string;
  tenantName: string;
  checklist: CloseChecklistRow[];
  budget: { costCenter: string; category: string; plannedMinor: string; committedMinor: string; actualMinor: string; remainingMinor: string }[];
  apAging: { vendor: string; notDue: string; d1_7: string; d8_30: string; d31_60: string; d60: string; total: string }[];
  arAging: { customer: string; total: string; overdue: string }[];
  taxes: { name: string; period: string; due: string; status: string; calculated: string }[];
  events: { number: string; name: string; date: string; status: string; revenue: string; margin: string }[];
  exceptions: { number: string; type: string; reason: string; approvedBy: string }[];
  cashWeeks: { week: string; inflow: string; outflow: string; closing: string }[];
}

export async function getMonthEndPackData(ctx: TenantContext, period: string): Promise<MonthEndPackData> {
  requirePermission(ctx, 'close.run');
  const { from, to } = periodRange(period);
  const [tenant, checklist, budget, ap, ar, taxes, events, exceptions, forecast, users] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
    getCloseChecklist(ctx, period),
    listBudgetMatrix(ctx, period),
    getApAging(ctx),
    getArAging(ctx),
    prisma.taxObligation.findMany({ where: { tenantId: ctx.tenantId, period } }),
    prisma.event.findMany({ where: { tenantId: ctx.tenantId, eventDate: { gte: from, lt: to } } }),
    prisma.paymentRequest.findMany({
      where: { tenantId: ctx.tenantId, exceptionType: { not: null }, updatedAt: { gte: from, lt: to } },
    }),
    getCashForecast(ctx),
    prisma.user.findMany({ select: { id: true, fullName: true } }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.fullName]));
  const soum = (minor: bigint) => (minor / 100n).toString();

  return {
    period,
    tenantName: tenant.legalName,
    checklist,
    budget: budget.map((row) => ({
      costCenter: row.costCenter.code,
      category: row.category.name,
      plannedMinor: soum(row.status.plannedMinor),
      committedMinor: soum(row.status.committedMinor),
      actualMinor: soum(row.status.actualMinor),
      remainingMinor: soum(row.status.remainingMinor),
    })),
    apAging: ap.map((row) => ({
      vendor: row.vendorName,
      notDue: soum(row.buckets.NOT_DUE),
      d1_7: soum(row.buckets.D1_7),
      d8_30: soum(row.buckets.D8_30),
      d31_60: soum(row.buckets.D31_60),
      d60: soum(row.buckets.D60_PLUS),
      total: soum(row.totalMinor),
    })),
    arAging: ar.map((row) => ({
      customer: row.customerName,
      total: soum(row.totalMinor),
      overdue: soum(row.invoices.filter((inv) => inv.status === 'OVERDUE').reduce((sum, inv) => sum + inv.outstandingMinor, 0n)),
    })),
    taxes: taxes.map((tax) => ({
      name: tax.name,
      period: tax.period,
      due: tax.dueDate.toISOString().slice(0, 10),
      status: tax.status,
      calculated: tax.calculatedMinor != null ? soum(tax.calculatedMinor) : '',
    })),
    events: events.map((event) => ({
      number: event.number,
      name: event.name,
      date: event.eventDate.toISOString().slice(0, 10),
      status: event.status,
      revenue: soum(event.revenueBudgetMinor),
      margin: soum(event.revenueBudgetMinor - event.costBudgetMinor),
    })),
    exceptions: exceptions.map((payment) => ({
      number: payment.number,
      type: payment.exceptionType ?? '',
      reason: payment.exceptionReason ?? '',
      approvedBy: payment.exceptionApprovedBy ? (userName.get(payment.exceptionApprovedBy) ?? '') : '',
    })),
    cashWeeks: forecast.weeks.map((week, i) => ({
      week: `W${i + 1} ${week.weekStart.toISOString().slice(5, 10)}`,
      inflow: soum(week.inflowArMinor + week.inflowPlanMinor),
      outflow: soum(week.outflowPaymentsMinor + week.outflowPrMinor + week.outflowPlanMinor),
      closing: soum(week.closingMinor),
    })),
  };
}
