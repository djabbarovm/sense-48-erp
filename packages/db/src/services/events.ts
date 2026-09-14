/**
 * D-03: Event — state machine (BR-061/062), budget lines (fast lane B-06),
 * v_event_pl, refund tasks при отмене c депозитами.
 */
import type { EventPayload, EventStatusCore, EventTrigger, TenantContext } from '@finance-os/core';
import { ValidationError, eventMachine, hasRole, requirePermission } from '@finance-os/core';
import type { EventStatus, Prisma } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { nextNumber } from '../sequence.js';

export interface DepositScheduleItem {
  pct: number;
  due_date: string;
  received_minor?: string;
  received_at?: string;
}

export interface EventInput {
  name: string;
  eventDate: Date;
  customerId?: string | null;
  format?: 'BANQUET' | 'CONFERENCE' | 'PRIVATE' | 'PUBLIC';
  guestsPlanned?: number | null;
  revenueBudgetMinor?: bigint;
  costBudgetMinor?: bigint;
  revenueLines?: Record<string, string | number>;
  depositSchedule?: DepositScheduleItem[];
  costCenterId?: string | null;
}

export async function createEvent(ctx: TenantContext, input: EventInput) {
  requirePermission(ctx, 'event.create');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const number = await nextNumber(tx, ctx.tenantId, 'EVT', input.eventDate);
    const created = await tx.event.create({
      data: {
        tenantId: ctx.tenantId,
        number,
        name: input.name,
        eventDate: input.eventDate,
        customerId: input.customerId ?? null,
        format: input.format ?? 'PRIVATE',
        guestsPlanned: input.guestsPlanned ?? null,
        revenueBudgetMinor: input.revenueBudgetMinor ?? 0n,
        costBudgetMinor: input.costBudgetMinor ?? 0n,
        revenueLines: (input.revenueLines ?? {}) as Prisma.InputJsonValue,
        depositSchedule: (input.depositSchedule ?? []) as unknown as Prisma.InputJsonValue,
        costCenterId: input.costCenterId ?? null,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'event.create',
        objectType: 'event',
        objectId: created.id,
        after: { number, name: input.name, eventDate: input.eventDate.toISOString().slice(0, 10) },
      },
    };
  });
}

/** Cost budget line события — основа fast lane (docs/04 PR). */
export async function upsertEventBudgetLine(
  ctx: TenantContext,
  eventId: string,
  input: { categoryId: string; plannedMinor: bigint; approvedVendorIds?: string[] },
) {
  requirePermission(ctx, 'event.edit');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    await findScopedOr404(tx.event, ctx, eventId);
    const line = await tx.eventBudgetLine.upsert({
      where: { eventId_categoryId: { eventId, categoryId: input.categoryId } },
      create: {
        tenantId: ctx.tenantId,
        eventId,
        categoryId: input.categoryId,
        plannedMinor: input.plannedMinor,
        approvedVendorIds: input.approvedVendorIds ?? [],
      },
      update: {
        plannedMinor: input.plannedMinor,
        ...(input.approvedVendorIds ? { approvedVendorIds: input.approvedVendorIds } : {}),
      },
    });
    // cost budget события = сумма линий
    const sum = await tx.eventBudgetLine.aggregate({ where: { eventId }, _sum: { plannedMinor: true } });
    await tx.event.update({ where: { id: eventId }, data: { costBudgetMinor: sum._sum.plannedMinor ?? 0n } });
    return {
      result: line,
      audit: {
        action: 'event.budget_line',
        objectType: 'event',
        objectId: eventId,
        after: { categoryId: input.categoryId, plannedMinor: input.plannedMinor.toString() },
      },
    };
  });
}

/** BR-062: получение депозита (из bank-сверки или вручную c указанием транзакции). */
export async function recordDeposit(ctx: TenantContext, eventId: string, index: number, receivedMinor: bigint) {
  requirePermission(ctx, 'ar.invoice.manage');
  if (receivedMinor <= 0n) throw new ValidationError('AMOUNT_INVALID');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const event = await findScopedOr404(tx.event, ctx, eventId);
    const schedule = (event.depositSchedule as unknown as DepositScheduleItem[]) ?? [];
    const item = schedule[index];
    if (!item) throw new ValidationError('DEPOSIT_INDEX_INVALID');
    item.received_minor = ((BigInt(item.received_minor ?? '0')) + receivedMinor).toString();
    item.received_at = new Date().toISOString();
    const after = await tx.event.update({
      where: { id: eventId },
      data: { depositSchedule: schedule as unknown as Prisma.InputJsonValue, updatedBy: ctx.userId },
    });
    return {
      result: after,
      audit: {
        action: 'event.deposit_received',
        objectType: 'event',
        objectId: eventId,
        after: { index, receivedMinor: receivedMinor.toString() },
      },
    };
  });
}

function depositOk(event: { depositSchedule: unknown; revenueBudgetMinor: bigint }): boolean {
  const schedule = (event.depositSchedule as DepositScheduleItem[]) ?? [];
  const first = schedule[0];
  if (!first) return true; // расписания нет — правило не применяется
  const required = (event.revenueBudgetMinor * BigInt(Math.round(first.pct * 100))) / 10_000n;
  return BigInt(first.received_minor ?? '0') >= required;
}

/** Переходы события. Для close BR-061 собирает блокеры; Owner может override c reason. */
export async function transitionEvent(
  ctx: TenantContext,
  eventId: string,
  trigger: EventTrigger,
  opts: { ownerOverride?: boolean; closeOverrideReason?: string; guestsActual?: number } = {},
) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const event = await findScopedOr404(tx.event, ctx, eventId);
    const payload: EventPayload = { isOwner: hasRole(ctx, 'OWNER') };
    if (trigger === 'quote') {
      payload.hasRevenueLines = Object.keys((event.revenueLines as object) ?? {}).length > 0;
    }
    if (trigger === 'confirm') {
      payload.hasCostLines = (await tx.eventBudgetLine.count({ where: { eventId } })) > 0;
      payload.depositOk = depositOk(event);
      payload.ownerOverride = opts.ownerOverride ?? false;
    }
    if (trigger === 'mark_held') payload.guestsActual = opts.guestsActual ?? event.guestsActual;
    if (trigger === 'close') {
      const [openPayments, advances, openAr, openTasks] = await Promise.all([
        tx.paymentRequest.count({
          where: { tenantId: ctx.tenantId, eventId, status: { notIn: ['PAID', 'RECONCILED', 'CLOSED', 'CANCELLED', 'REJECTED'] } },
        }),
        tx.advance.count({ where: { tenantId: ctx.tenantId, eventId, status: { notIn: ['CLOSED', 'WRITTEN_OFF'] } } }),
        tx.customerInvoice.count({ where: { tenantId: ctx.tenantId, eventId, status: { notIn: ['PAID', 'CANCELLED'] } } }),
        tx.task.count({ where: { tenantId: ctx.tenantId, objectType: 'event', objectId: eventId, status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] } } }),
      ]);
      payload.openPayments = openPayments;
      payload.openAdvances = advances;
      payload.openArInvoices = openAr;
      payload.openTasks = openTasks;
      if (opts.closeOverrideReason) payload.closeOverrideReason = opts.closeOverrideReason;
    }
    // close: базово Lead (event.close); Owner допускается только ради BR-061 override
    let machineCtx: TenantContext | null = ctx;
    if (trigger === 'close') {
      if (!hasRole(ctx, 'OWNER')) requirePermission(ctx, 'event.close');
      machineCtx = null; // permission уже проверен выше, guard BR-061 остаётся
    }
    const to = eventMachine.assert(machineCtx, event.status as EventStatusCore, trigger, payload);
    const after = await tx.event.update({
      where: { id: eventId },
      data: {
        status: to as EventStatus,
        ...(trigger === 'mark_held' && opts.guestsActual != null ? { guestsActual: opts.guestsActual } : {}),
        updatedBy: ctx.userId,
      },
    });
    // отмена c полученными депозитами → refund task (docs/04)
    if (trigger === 'cancel') {
      const schedule = (event.depositSchedule as unknown as DepositScheduleItem[]) ?? [];
      const received = schedule.reduce((sum, s) => sum + BigInt(s.received_minor ?? '0'), 0n);
      if (received > 0n) {
        await tx.task.create({
          data: {
            tenantId: ctx.tenantId,
            type: 'REVIEW_EXCEPTION',
            objectType: 'event',
            objectId: eventId,
            nextAction: `Событие ${event.number} отменено c полученными депозитами — оформить возврат клиенту`,
            createdBy: ctx.userId,
          },
        });
      }
    }
    return {
      result: after,
      audit: {
        action: `event.${trigger}`,
        objectType: 'event',
        objectId: eventId,
        before: { status: event.status },
        after: { status: to, ...(opts.closeOverrideReason ? { closeOverrideReason: opts.closeOverrideReason } : {}) },
      },
    };
  });
}

/** Авто-джоб (D-05): CONFIRMED c event_date <= today → IN_PROGRESS; HELD → SETTLING. */
export async function progressEvents(tenantId: string, now = new Date()): Promise<number> {
  let moved = 0;
  const confirmed = await prisma.event.findMany({ where: { tenantId, status: 'CONFIRMED', eventDate: { lte: now } } });
  for (const event of confirmed) {
    await withAudit({ tenantId }, async (tx) => ({
      result: await tx.event.update({ where: { id: event.id }, data: { status: 'IN_PROGRESS' } }),
      audit: { action: 'event.start', objectType: 'event', objectId: event.id, before: { status: 'CONFIRMED' }, after: { status: 'IN_PROGRESS' } },
    }));
    moved++;
  }
  const held = await prisma.event.findMany({ where: { tenantId, status: 'HELD' } });
  for (const event of held) {
    await withAudit({ tenantId }, async (tx) => ({
      result: await tx.event.update({ where: { id: event.id }, data: { status: 'SETTLING' } }),
      audit: { action: 'event.settle', objectType: 'event', objectId: event.id, before: { status: 'HELD' }, after: { status: 'SETTLING' } },
    }));
    moved++;
  }
  return moved;
}

// ── v_event_pl (docs/02 §9) ──

export interface EventPl {
  revenueBudgetMinor: bigint;
  revenueInvoicedMinor: bigint; // CINV по событию (кроме CANCELLED)
  depositsReceivedMinor: bigint;
  receivedMinor: bigint; // фактические поступления по CINV
  arOutstandingMinor: bigint;
  costBudgetMinor: bigint;
  committedMinor: bigint; // PR approved+ и payments pending
  actualMinor: bigint; // payments PAID
  marginPlanMinor: bigint;
  marginCurrentMinor: bigint; // revenue invoiced − (actual + committed)
  costByCategory: { categoryId: string; plannedMinor: bigint; committedMinor: bigint; actualMinor: bigint }[];
  /** E-03: фактические затраты банкета из iiko (аналитика, в margin не дублируются) */
  posFoodCostMinor: bigint;
  posBeverageCostMinor: bigint;
}

const PAY_PENDING = ['SUBMITTED', 'DOCS_CHECK', 'ON_HOLD', 'READY_FOR_BATCH', 'IN_BATCH', 'APPROVED', 'SENT_TO_BANK'] as const;
const PAY_PAID = ['PAID', 'RECONCILED', 'CLOSED'] as const;

export async function getEventPl(ctx: TenantContext, eventId: string): Promise<EventPl> {
  requirePermission(ctx, 'payment.view');
  const event = await findScopedOr404(prisma.event, ctx, eventId);
  const [invoices, payments, budgetLines, prs] = await Promise.all([
    prisma.customerInvoice.findMany({ where: { tenantId: ctx.tenantId, eventId, status: { not: 'CANCELLED' } } }),
    prisma.paymentRequest.findMany({ where: { tenantId: ctx.tenantId, eventId } }),
    prisma.eventBudgetLine.findMany({ where: { eventId } }),
    prisma.purchaseRequest.findMany({
      where: { tenantId: ctx.tenantId, eventId: eventId, status: { in: ['APPROVED', 'ORDERED', 'RECEIVED', 'INVOICED'] } },
    }),
  ]);
  const schedule = (event.depositSchedule as unknown as DepositScheduleItem[]) ?? [];
  const deposits = schedule.reduce((sum, s) => sum + BigInt(s.received_minor ?? '0'), 0n);
  const invoiced = invoices.reduce((sum, i) => sum + i.amountGrossMinor, 0n);
  const received = invoices.reduce((sum, i) => sum + i.receivedMinor, 0n);
  const actual = payments.filter((p) => (PAY_PAID as readonly string[]).includes(p.status)).reduce((s, p) => s + p.requestedMinor, 0n);
  const pending = payments.filter((p) => (PAY_PENDING as readonly string[]).includes(p.status)).reduce((s, p) => s + p.requestedMinor, 0n);
  // committed: pending платежи + approved PR, по которым ещё нет платежей
  const prIdsWithPayments = new Set(payments.filter((p) => p.sourceType === 'PR').map((p) => p.sourceId));
  const prCommitted = prs.filter((p) => !prIdsWithPayments.has(p.id)).reduce((s, p) => s + p.totalMinor, 0n);
  const committed = pending + prCommitted;

  const costByCategory = budgetLines.map((line) => {
    const catPayments = payments.filter((p) => p.categoryId === line.categoryId);
    const catActual = catPayments.filter((p) => (PAY_PAID as readonly string[]).includes(p.status)).reduce((s, p) => s + p.requestedMinor, 0n);
    const catPending = catPayments.filter((p) => (PAY_PENDING as readonly string[]).includes(p.status)).reduce((s, p) => s + p.requestedMinor, 0n);
    const catPrs = prs.filter((p) => p.categoryId === line.categoryId && !prIdsWithPayments.has(p.id)).reduce((s, p) => s + p.totalMinor, 0n);
    return { categoryId: line.categoryId, plannedMinor: line.plannedMinor, committedMinor: catPending + catPrs, actualMinor: catActual };
  });

  const { getEventPosCost } = await import('./pos.js');
  const posCost = await getEventPosCost(ctx.tenantId, eventId);
  return {
    posFoodCostMinor: posCost.foodCostMinor,
    posBeverageCostMinor: posCost.beverageCostMinor,
    revenueBudgetMinor: event.revenueBudgetMinor,
    revenueInvoicedMinor: invoiced,
    depositsReceivedMinor: deposits,
    receivedMinor: received,
    arOutstandingMinor: invoiced - received,
    costBudgetMinor: event.costBudgetMinor,
    committedMinor: committed,
    actualMinor: actual,
    marginPlanMinor: event.revenueBudgetMinor - event.costBudgetMinor,
    marginCurrentMinor: (invoiced > 0n ? invoiced : event.revenueBudgetMinor) - actual - committed,
    costByCategory,
  };
}

export async function listEvents(ctx: TenantContext, filter?: { status?: EventStatus[] }) {
  requirePermission(ctx, 'payment.view');
  return prisma.event.findMany({
    where: whereTenant(ctx, filter?.status ? { status: { in: filter.status } } : {}),
    orderBy: { eventDate: 'desc' },
    take: 100,
  });
}

export async function getEvent(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'payment.view');
  const event = await findScopedOr404(prisma.event, ctx, id);
  const [budgetLines, payments, invoices, tasks] = await Promise.all([
    prisma.eventBudgetLine.findMany({ where: { eventId: id } }),
    prisma.paymentRequest.findMany({ where: { tenantId: ctx.tenantId, eventId: id }, orderBy: { number: 'asc' } }),
    prisma.customerInvoice.findMany({ where: { tenantId: ctx.tenantId, eventId: id } }),
    prisma.task.findMany({ where: { tenantId: ctx.tenantId, objectType: 'event', objectId: id } }),
  ]);
  return { event, budgetLines, payments, invoices, tasks };
}
