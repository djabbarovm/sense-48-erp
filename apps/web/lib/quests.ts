import 'server-only';
import type { TenantContext } from '@finance-os/core';
import { listMyPendingApprovals, prisma } from '@finance-os/db';

/** «Миссия дня» — квест-чеклист операционного дня + стрик и green-flow score. */

export interface QuestItem {
  key: string;
  done: boolean;
  count?: number;
}

export interface DailyMission {
  items: QuestItem[];
  progress: number; // 0..1
  streakDays: number; // дней подряд без просрочек и дублей
  greenFlowPct: number; // % платежей за 30д без FAIL-контролей
  cutoff: string;
}

export async function getDailyMission(ctx: TenantContext): Promise<DailyMission> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400_000);

  const [batch, unmatched, openTasks, pendingApprovals, tenant] = await Promise.all([
    prisma.paymentBatch.findFirst({
      where: { tenantId: ctx.tenantId, type: 'STANDARD', batchDate: { gte: today, lt: tomorrow }, status: { not: 'CANCELLED' } },
    }),
    prisma.bankTransaction.count({ where: { tenantId: ctx.tenantId, matchStatus: 'UNMATCHED' } }),
    prisma.task.count({ where: { tenantId: ctx.tenantId, status: { in: ['OPEN', 'OVERDUE'] } } }),
    listMyPendingApprovals(ctx).then((r) => r.length),
    prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
  ]);

  const frozen = batch ? !['OPEN'].includes(batch.status) : false;
  const approved = batch ? ['APPROVED', 'PARTIALLY_APPROVED', 'EXPORTED', 'SENT', 'SETTLED'].includes(batch.status) : false;

  const items: QuestItem[] = [
    { key: 'collectBatch', done: Boolean(batch) },
    { key: 'freezeBatch', done: frozen },
    { key: 'approveBatch', done: approved },
    { key: 'clearApprovals', done: pendingApprovals === 0, count: pendingApprovals },
    { key: 'clearUnmatched', done: unmatched === 0, count: unmatched },
    { key: 'clearTasks', done: openTasks === 0, count: openTasks },
  ];
  const progress = items.filter((i) => i.done).length / items.length;

  // стрик: дни подряд (до 30) без новых OVERDUE-эскалаций и дублей
  const since = new Date(today.getTime() - 30 * 86400_000);
  const [overdueEvents, dupEvents] = await Promise.all([
    prisma.task.findMany({
      where: { tenantId: ctx.tenantId, escalatedAt: { gte: since } },
      select: { escalatedAt: true },
    }),
    prisma.invoice.findMany({
      where: { tenantId: ctx.tenantId, status: 'DUPLICATE_SUSPECT', createdAt: { gte: since } },
      select: { createdAt: true },
    }),
  ]);
  const badDays = new Set<string>();
  for (const e of overdueEvents) if (e.escalatedAt) badDays.add(e.escalatedAt.toISOString().slice(0, 10));
  for (const e of dupEvents) badDays.add(e.createdAt.toISOString().slice(0, 10));
  let streakDays = 0;
  for (let i = 0; i < 30; i++) {
    const day = new Date(today.getTime() - i * 86400_000).toISOString().slice(0, 10);
    if (badDays.has(day)) break;
    streakDays++;
  }

  // green flow: % платежей за 30 дней без FAIL в controls_result
  const payments = await prisma.paymentRequest.findMany({
    where: { tenantId: ctx.tenantId, createdAt: { gte: since }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
    select: { controlsResult: true },
  });
  const green = payments.filter((p) => {
    const controls = p.controlsResult as { result: string }[] | null;
    return !controls || controls.every((c) => c.result !== 'FAIL');
  }).length;
  const greenFlowPct = payments.length === 0 ? 100 : Math.round((green / payments.length) * 100);

  const cutoff = ((tenant.settings as Record<string, unknown>).cutoff_time as string) ?? '14:00';
  return { items, progress, streakDays, greenFlowPct, cutoff };
}
