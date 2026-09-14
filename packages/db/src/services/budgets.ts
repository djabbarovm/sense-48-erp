/**
 * B-04/D-07: Budget + v_budget_status (BR-014).
 * committed = PR APPROVED/ORDERED/RECEIVED/INVOICED без платежей + pending-платежи;
 * actual = PAID/RECONCILED/CLOSED платежи по paid_at периода.
 */
import type { TenantContext } from '@finance-os/core';
import { ValidationError, requirePermission } from '@finance-os/core';
import type { BudgetCheckStatus, Prisma } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { whereTenant } from '../repository.js';

const COMMITTED_PR_STATUSES = ['APPROVED', 'ORDERED', 'RECEIVED', 'INVOICED'] as const;
const PENDING_PAY_STATUSES = ['SUBMITTED', 'DOCS_CHECK', 'ON_HOLD', 'READY_FOR_BATCH', 'IN_BATCH', 'APPROVED', 'SENT_TO_BANK'] as const;
const PAID_PAY_STATUSES = ['PAID', 'RECONCILED', 'CLOSED'] as const;

export function assertPeriod(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ValidationError('PERIOD_INVALID', 'Период — YYYY-MM');
}

export async function upsertBudgetLine(
  ctx: TenantContext,
  input: { period: string; costCenterId: string; categoryId: string; plannedMinor: bigint },
) {
  requirePermission(ctx, 'budget.manage');
  assertPeriod(input.period);
  if (input.plannedMinor < 0n) throw new ValidationError('PLANNED_NEGATIVE');
  const [cc, cat] = await Promise.all([
    prisma.costCenter.findFirst({ where: { id: input.costCenterId, tenantId: ctx.tenantId } }),
    prisma.category.findFirst({ where: { id: input.categoryId, tenantId: ctx.tenantId } }),
  ]);
  if (!cc || !cat) throw new ValidationError('CC_OR_CATEGORY_NOT_FOUND');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const existing = await tx.budget.findUnique({
      where: {
        tenantId_period_costCenterId_categoryId: {
          tenantId: ctx.tenantId,
          period: input.period,
          costCenterId: input.costCenterId,
          categoryId: input.categoryId,
        },
      },
    });
    const row = existing
      ? await tx.budget.update({
          where: { id: existing.id },
          data: { plannedMinor: input.plannedMinor, updatedBy: ctx.userId },
        })
      : await tx.budget.create({
          data: {
            tenantId: ctx.tenantId,
            period: input.period,
            costCenterId: input.costCenterId,
            categoryId: input.categoryId,
            plannedMinor: input.plannedMinor,
            createdBy: ctx.userId,
          },
        });
    return {
      result: row,
      audit: {
        action: existing ? 'budget.update' : 'budget.create',
        objectType: 'budget',
        objectId: row.id,
        before: existing ? { plannedMinor: existing.plannedMinor.toString() } : null,
        after: { period: row.period, plannedMinor: row.plannedMinor.toString() },
      },
    };
  });
}

export interface BudgetStatusRow {
  period: string;
  costCenterId: string;
  categoryId: string;
  plannedMinor: bigint;
  committedMinor: bigint;
  actualMinor: bigint;
  remainingMinor: bigint;
}

function periodRange(period: string): { from: Date; to: Date } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

/** D-07: committed = PR без платежей (по created_at) + pending-платежи; actual = PAID-платежи по paid_at. */
async function sumCommittedAndActual(
  tx: Prisma.TransactionClient,
  tenantId: string,
  period: string,
  costCenterId: string,
  categoryId: string,
): Promise<{ committed: bigint; actual: bigint }> {
  const { from, to } = periodRange(period);
  const prs = await tx.purchaseRequest.findMany({
    where: {
      tenantId,
      costCenterId,
      categoryId,
      status: { in: COMMITTED_PR_STATUSES as never },
      createdAt: { gte: from, lt: to },
    },
    select: { id: true, totalMinor: true },
  });
  // PR, по которым уже есть живой платёж, считаются через платежи (без двойного счёта)
  const covered = new Set(
    (
      await tx.paymentRequest.findMany({
        where: {
          tenantId,
          sourceType: 'PR',
          sourceId: { in: prs.map((p) => p.id) },
          status: { notIn: ['CANCELLED', 'REJECTED', 'FAILED'] },
        },
        select: { sourceId: true },
      })
    ).map((p) => p.sourceId),
  );
  const prCommitted = prs.filter((p) => !covered.has(p.id)).reduce((sum, p) => sum + p.totalMinor, 0n);
  const [pendingAgg, paidAgg] = await Promise.all([
    tx.paymentRequest.aggregate({
      where: {
        tenantId,
        costCenterId,
        categoryId,
        status: { in: [...PENDING_PAY_STATUSES] },
        createdAt: { gte: from, lt: to },
      },
      _sum: { requestedMinor: true },
    }),
    tx.paymentRequest.aggregate({
      where: {
        tenantId,
        costCenterId,
        categoryId,
        status: { in: [...PAID_PAY_STATUSES] },
        paidAt: { gte: from, lt: to },
      },
      _sum: { requestedMinor: true },
    }),
  ]);
  return {
    committed: prCommitted + (pendingAgg._sum.requestedMinor ?? 0n),
    actual: paidAgg._sum.requestedMinor ?? 0n,
  };
}

/** v_budget_status(period, cc, category) → planned/committed/actual/remaining. */
export async function getBudgetStatus(
  ctx: TenantContext,
  period: string,
  costCenterId: string,
  categoryId: string,
): Promise<BudgetStatusRow | null> {
  assertPeriod(period);
  return prisma.$transaction(async (tx) => {
    const budget = await tx.budget.findUnique({
      where: {
        tenantId_period_costCenterId_categoryId: {
          tenantId: ctx.tenantId,
          period,
          costCenterId,
          categoryId,
        },
      },
    });
    if (!budget) return null;
    const { committed, actual } = await sumCommittedAndActual(tx, ctx.tenantId, period, costCenterId, categoryId);
    return {
      period,
      costCenterId,
      categoryId,
      plannedMinor: budget.plannedMinor,
      committedMinor: committed,
      actualMinor: actual,
      remainingMinor: budget.plannedMinor - committed - actual,
    };
  });
}

/**
 * BR-014: budget check при submit PR.
 * remaining >= total → WITHIN; remaining < total → OVER (SOFT, Owner на любую сумму);
 * нет строки бюджета и category.budget_required → UNBUDGETED (HARD → Tier 3);
 * нет строки и не required → WITHIN.
 */
export async function checkBudget(
  ctx: TenantContext,
  input: { period: string; costCenterId: string; categoryId: string; totalMinor: bigint },
): Promise<BudgetCheckStatus> {
  const status = await getBudgetStatus(ctx, input.period, input.costCenterId, input.categoryId);
  if (!status) {
    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, tenantId: ctx.tenantId },
    });
    if (!category) throw new ValidationError('CATEGORY_NOT_FOUND');
    return category.budgetRequired ? 'UNBUDGETED' : 'WITHIN';
  }
  return status.remainingMinor >= input.totalMinor ? 'WITHIN' : 'OVER';
}

/** Матрица бюджета за период для экрана. */
export async function listBudgetMatrix(ctx: TenantContext, period: string) {
  assertPeriod(period);
  const rows = await prisma.budget.findMany({
    where: whereTenant(ctx, { period }),
    include: { costCenter: { select: { code: true } }, category: { select: { code: true, name: true } } },
    orderBy: [{ costCenter: { code: 'asc' } }, { category: { code: 'asc' } }],
  });
  const result = [];
  for (const row of rows) {
    const status = await getBudgetStatus(ctx, period, row.costCenterId, row.categoryId);
    result.push({ ...row, status: status! });
  }
  return result;
}
