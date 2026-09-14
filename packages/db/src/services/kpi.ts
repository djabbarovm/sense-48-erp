/**
 * F-06: KPI (blueprint §21 — состав зафиксирован в ADR-010) + daily snapshot.
 * Все метрики считаются из живых данных; KpiSnapshot хранит дневной срез
 * для трендов на экране Controls.
 */
import type { TenantContext } from '@finance-os/core';
import { requirePermission } from '@finance-os/core';
import { prisma } from '../client.js';
import { HEALTH_ZONES, getDocumentHealth } from './documentHealth.js';

export interface KpiMetrics {
  /** D-13: целевой KPI urgent < 10% по количеству (30 дней) */
  urgentPct30d: number;
  /** % платежей 30д, прошедших контроли без FAIL */
  greenFlowPct30d: number;
  /** дубликатов СФ поймано (30 дней, BR-002) */
  duplicatesPrevented30d: number;
  /** платежи, стоящие на ON_HOLD сейчас */
  openHolds: number;
  /** одобренные exceptions за 30 дней (BR-050) */
  exceptionsApproved30d: number;
  /** % просроченной кредиторки (сумма) */
  apOverduePct: number;
  /** % просроченной дебиторки (сумма) */
  arOverduePct: number;
  /** документное здоровье: количество проблем по 9 зонам */
  docIssues: number;
  /** задачи OVERDUE сейчас */
  overdueTasks: number;
  /** батчи за 30 дней, замороженные автоматом в cutoff (дисциплина) */
  autoFrozenBatches30d: number;
}

export async function computeKpis(ctx: TenantContext, now = new Date()): Promise<KpiMetrics> {
  requirePermission(ctx, 'dashboard.ops');
  const t = ctx.tenantId;
  const from30 = new Date(now.getTime() - 30 * 86400_000);

  const [payments30, holds, dup30, overdueTasks, exceptions30, apInvoices, arInvoices, autoFrozen] = await Promise.all([
    prisma.paymentRequest.findMany({
      where: { tenantId: t, createdAt: { gte: from30 }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
      select: { isUrgent: true, controlsResult: true },
    }),
    prisma.paymentRequest.count({ where: { tenantId: t, status: 'ON_HOLD' } }),
    prisma.invoice.count({ where: { tenantId: t, status: 'DUPLICATE_SUSPECT', createdAt: { gte: from30 } } }),
    prisma.task.count({ where: { tenantId: t, status: 'OVERDUE' } }),
    prisma.paymentRequest.count({
      where: { tenantId: t, exceptionApprovedBy: { not: null }, updatedAt: { gte: from30 } },
    }),
    prisma.invoice.findMany({
      where: { tenantId: t, status: { in: ['RECEIVED', 'MATCHED', 'DISPUTED', 'PARTIALLY_PAID'] as const } },
      select: { amountGrossMinor: true, date: true },
    }),
    prisma.customerInvoice.findMany({
      where: { tenantId: t, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] as const } },
      select: { amountGrossMinor: true, receivedMinor: true, dueDate: true, status: true },
    }),
    prisma.auditLog.count({ where: { tenantId: t, action: 'batch.auto_freeze', at: { gte: from30 } } }),
  ]);

  const urgent = payments30.filter((p) => p.isUrgent).length;
  const green = payments30.filter((p) => {
    const controls = (p.controlsResult as { result?: string }[] | null) ?? [];
    return controls.length > 0 && controls.every((c) => c.result !== 'FAIL');
  }).length;
  const pct = (num: number, den: number) => (den === 0 ? 0 : Math.round((num / den) * 100));

  const apTotal = apInvoices.reduce((sum, inv) => sum + inv.amountGrossMinor, 0n);
  const apOverdue = apInvoices
    .filter((inv) => now.getTime() - inv.date.getTime() > 30 * 86400_000)
    .reduce((sum, inv) => sum + inv.amountGrossMinor, 0n);
  const arTotal = arInvoices.reduce((sum, inv) => sum + (inv.amountGrossMinor - inv.receivedMinor), 0n);
  const arOverdue = arInvoices
    .filter((inv) => inv.status === 'OVERDUE' || inv.dueDate < now)
    .reduce((sum, inv) => sum + (inv.amountGrossMinor - inv.receivedMinor), 0n);
  const pctBig = (num: bigint, den: bigint) => (den === 0n ? 0 : Number((num * 100n) / den));

  const health = await getDocumentHealth(ctx, now);
  const docIssues = HEALTH_ZONES.reduce((sum, zone) => sum + health[zone].length, 0);

  return {
    urgentPct30d: pct(urgent, payments30.length),
    greenFlowPct30d: pct(green, payments30.length),
    duplicatesPrevented30d: dup30,
    openHolds: holds,
    exceptionsApproved30d: exceptions30,
    apOverduePct: pctBig(apOverdue, apTotal),
    arOverduePct: pctBig(arOverdue, arTotal),
    docIssues,
    overdueTasks,
    autoFrozenBatches30d: autoFrozen,
  };
}

/** Job (D-05): дневной срез KPI. Идемпотентен по (tenant, date). */
export async function snapshotKpis(tenantId: string, now = new Date()): Promise<void> {
  const roles = await prisma.userTenantRole.findFirst({ where: { tenantId, role: 'OWNER' } });
  const ctx = {
    tenantId,
    tenantSlug: '',
    userId: roles?.userId ?? null,
    roles: ['OWNER'],
  } as unknown as TenantContext;
  const metrics = await computeKpis(ctx, now);
  const date = new Date(now.toISOString().slice(0, 10));
  await prisma.kpiSnapshot.upsert({
    where: { tenantId_date: { tenantId, date } },
    create: { tenantId, date, metrics: metrics as object },
    update: { metrics: metrics as object },
  });
}

export async function listKpiSnapshots(ctx: TenantContext, days = 30) {
  requirePermission(ctx, 'dashboard.ops');
  return prisma.kpiSnapshot.findMany({
    where: { tenantId: ctx.tenantId, date: { gte: new Date(Date.now() - days * 86400_000) } },
    orderBy: { date: 'asc' },
  });
}
