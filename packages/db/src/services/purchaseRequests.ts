/**
 * B-06: PurchaseRequest workflow (docs/04, BR-014/041/042/043/044/045, D-12).
 */
import type { PrStatus, PrTrigger, TenantContext } from '@finance-os/core';
import {
  NotFoundError,
  ValidationError,
  computeRequiredApprovals,
  hasRole,
  prMachine,
  requirePermission,
} from '@finance-os/core';
import type { Prisma, PurchaseRequest, UrgencyReason } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { checkBudget } from './budgets.js';
import { getActivePolicy } from './policies.js';
import { nextNumber } from '../sequence.js';
import { RISK_NEW, RISK_RELATED_PARTY } from './vendors.js';

export interface PrInput {
  what: string;
  purpose: string;
  quantity?: string;
  unit?: string;
  priceMinor?: bigint;
  vatMinor?: bigint;
  totalMinor: bigint;
  currency?: string;
  costCenterId: string;
  categoryId: string;
  eventId?: string | null;
  neededBy?: Date | null;
  vendorId?: string | null;
  contractId?: string | null;
  isUrgent?: boolean;
  urgencyReason?: UrgencyReason | null;
  urgencyNote?: string | null;
  varianceReason?: string | null;
}

async function validateRefs(ctx: TenantContext, input: PrInput) {
  const [cc, cat] = await Promise.all([
    prisma.costCenter.findFirst({ where: { id: input.costCenterId, tenantId: ctx.tenantId } }),
    prisma.category.findFirst({ where: { id: input.categoryId, tenantId: ctx.tenantId } }),
  ]);
  if (!cc) throw new ValidationError('cost_center_id required');
  if (!cat) throw new ValidationError('category_id required');
  if (input.vendorId) {
    const vendor = await prisma.vendor.findFirst({ where: { id: input.vendorId, tenantId: ctx.tenantId } });
    if (!vendor) throw new NotFoundError();
  }
  if (input.eventId) {
    const event = await prisma.event.findFirst({ where: { id: input.eventId, tenantId: ctx.tenantId } });
    if (!event) throw new NotFoundError();
  }
  if (input.contractId) {
    const contract = await prisma.contract.findFirst({ where: { id: input.contractId, tenantId: ctx.tenantId } });
    if (!contract) throw new NotFoundError();
  }
  return { cc, cat };
}

export async function createPr(ctx: TenantContext, input: PrInput) {
  requirePermission(ctx, 'pr.create');
  if (!input.what.trim()) throw new ValidationError('WHAT_REQUIRED', 'Опишите, что покупаем');
  if (input.totalMinor <= 0n) throw new ValidationError('TOTAL_INVALID');
  await validateRefs(ctx, input);
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const number = await nextNumber(tx, ctx.tenantId, 'PR');
    const created = await tx.purchaseRequest.create({
      data: {
        tenantId: ctx.tenantId,
        number,
        requesterId: ctx.userId,
        what: input.what,
        purpose: input.purpose,
        quantity: input.quantity ?? null,
        unit: input.unit ?? null,
        priceMinor: input.priceMinor ?? null,
        vatMinor: input.vatMinor ?? 0n,
        totalMinor: input.totalMinor,
        currency: input.currency ?? 'UZS',
        costCenterId: input.costCenterId,
        categoryId: input.categoryId,
        eventId: input.eventId ?? null,
        neededBy: input.neededBy ?? null,
        vendorId: input.vendorId ?? null,
        contractId: input.contractId ?? null,
        isUrgent: input.isUrgent ?? false,
        urgencyReason: input.urgencyReason ?? null,
        urgencyNote: input.urgencyNote ?? null,
        varianceReason: input.varianceReason ?? null,
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'pr.create',
        objectType: 'purchase_request',
        objectId: created.id,
        after: { number, what: created.what, totalMinor: created.totalMinor.toString() },
      },
    };
  });
}

/** Проверка fast lane (docs/04): PR внутри утверждённого бюджета события. */
async function checkFastLane(
  tx: Prisma.TransactionClient,
  pr: PurchaseRequest,
): Promise<boolean> {
  if (!pr.eventId || !pr.vendorId) return false;
  const event = await tx.event.findUnique({ where: { id: pr.eventId } });
  if (!event || event.status !== 'CONFIRMED') return false;
  const line = await tx.eventBudgetLine.findUnique({
    where: { eventId_categoryId: { eventId: pr.eventId, categoryId: pr.categoryId } },
  });
  if (!line || !line.approvedVendorIds.includes(pr.vendorId)) return false;
  // остаток линии: planned − сумма других PR этой линии (approved+)
  const used = await tx.purchaseRequest.aggregate({
    where: {
      eventId: pr.eventId,
      categoryId: pr.categoryId,
      id: { not: pr.id },
      status: { in: ['APPROVED', 'ORDERED', 'RECEIVED', 'INVOICED', 'PAID', 'CLOSED'] },
    },
    _sum: { totalMinor: true },
  });
  const remaining = line.plannedMinor - (used._sum.totalMinor ?? 0n);
  return pr.totalMinor <= remaining;
}

/**
 * Submit (BR-014 budget check, BR-041 policy snapshot, BR-043 urgency, fast lane).
 */
export async function submitPr(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'pr.create');
  const pr = await findScopedOr404(prisma.purchaseRequest, ctx, id);
  if (pr.requesterId !== ctx.userId && !hasRole(ctx, 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE')) {
    throw new ValidationError('NOT_REQUESTER', 'Submit доступен автору заявки или финансовой роли');
  }
  // BR-043: urgent требует reason
  if (pr.isUrgent && !pr.urgencyReason) {
    throw new ValidationError('URGENCY_REASON_REQUIRED', 'Срочная заявка требует urgency_reason (BR-043)');
  }
  const period = new Date().toISOString().slice(0, 7);
  const budgetStatus = await checkBudget(ctx, {
    period,
    costCenterId: pr.costCenterId,
    categoryId: pr.categoryId,
    totalMinor: pr.totalMinor,
  });
  const policy = await getActivePolicy(ctx.tenantId);

  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const fastLane = await checkFastLane(tx, pr);
    const vendor = pr.vendorId ? await tx.vendor.findUnique({ where: { id: pr.vendorId } }) : null;
    const decision = computeRequiredApprovals(policy, {
      totalMinor: pr.totalMinor,
      budgetStatus,
      relatedParty: vendor?.riskFlags.includes(RISK_RELATED_PARTY) ?? false,
      newVendorFirstPayment: vendor?.riskFlags.includes(RISK_NEW) ?? false,
      isFastLane: fastLane,
    });
    if (decision.requiresVarianceReason && !pr.varianceReason) {
      throw new ValidationError('VARIANCE_REASON_REQUIRED', 'Tier 3 / unbudgeted требует variance_reason (D-12)');
    }
    const to = fastLane
      ? prMachine.assert(null, pr.status as PrStatus, 'fast_lane', {})
      : prMachine.assert(ctx, pr.status as PrStatus, 'submit', {});
    const after = await tx.purchaseRequest.update({
      where: { id },
      data: {
        status: to,
        budgetStatus,
        tier: decision.tier,
        isFastLane: fastLane,
        updatedBy: ctx.userId,
      },
    });
    if (!fastLane) {
      for (const slot of decision.approvals) {
        await tx.purchaseApproval.create({
          data: { tenantId: ctx.tenantId, prId: id, role: slot.role },
        });
      }
    }
    return {
      result: { pr: after, decision },
      audit: {
        action: fastLane ? 'pr.fast_lane' : 'pr.submit',
        objectType: 'purchase_request',
        objectId: id,
        before: { status: pr.status },
        after: {
          status: to,
          budgetStatus,
          tier: decision.tier,
          approvals: decision.approvals.map((a) => a.role),
        },
      },
    };
  });
}

/** Право голоса по слоту: BUSINESS_OWNER — Owner/Lead/владелец cost center; FINANCE — Lead всегда, Junior только Tier 1; OWNER — только Owner. */
async function assertSlotPermission(
  ctx: TenantContext,
  pr: PurchaseRequest,
  slotRole: string,
): Promise<void> {
  if (slotRole === 'BUSINESS_OWNER') {
    if (hasRole(ctx, 'OWNER', 'FINANCE_OPS_LEAD')) return;
    if (hasRole(ctx, 'REQUESTER')) {
      const cc = await prisma.costCenter.findUnique({ where: { id: pr.costCenterId } });
      if (cc?.ownerId === ctx.userId) return;
    }
    throw new ValidationError('PERMISSION_DENIED:pr.approve.business');
  }
  if (slotRole === 'FINANCE') {
    if (hasRole(ctx, 'FINANCE_OPS_LEAD')) return;
    if (hasRole(ctx, 'JUNIOR_FINANCE') && (pr.tier ?? 1) === 1) return;
    throw new ValidationError('PERMISSION_DENIED:pr.approve.finance');
  }
  if (slotRole === 'OWNER') {
    if (hasRole(ctx, 'OWNER')) return;
    throw new ValidationError('PERMISSION_DENIED:pr.approve.owner');
  }
  throw new ValidationError('UNKNOWN_SLOT');
}

export async function decidePrApproval(
  ctx: TenantContext,
  prId: string,
  slotRole: string,
  decision: 'APPROVED' | 'REJECTED',
  comment?: string,
) {
  const pr = await findScopedOr404(prisma.purchaseRequest, ctx, prId);
  // BR-044: решения только по SUBMITTED
  if (pr.status !== 'SUBMITTED') {
    throw new ValidationError('PR_NOT_SUBMITTED', `Approve только для SUBMITTED (BR-044); сейчас ${pr.status}`);
  }
  await assertSlotPermission(ctx, pr, slotRole);
  if (decision === 'REJECTED' && (!comment || comment.trim().length < 10)) {
    throw new ValidationError('REJECT_COMMENT_REQUIRED', 'Комментарий при отклонении — минимум 10 символов (BR-045)');
  }
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const slot = await tx.purchaseApproval.findFirst({
      where: { prId, role: slotRole, decision: null },
    });
    if (!slot) throw new ValidationError('SLOT_NOT_FOUND', `Нет ожидающего approval для роли ${slotRole}`);
    await tx.purchaseApproval.update({
      where: { id: slot.id },
      data: { approverId: ctx.userId, decision, comment: comment ?? null, decidedAt: new Date() },
    });
    let status: PrStatus = pr.status as PrStatus;
    if (decision === 'REJECTED') {
      status = prMachine.assert(null, status, 'reject', { comment: comment ?? '' });
    } else {
      const pending = await tx.purchaseApproval.count({ where: { prId, decision: null } });
      if (pending === 0) {
        status = prMachine.assert(null, status, 'approve_complete', { allApprovalsApproved: true });
      }
    }
    const after =
      status === pr.status
        ? pr
        : await tx.purchaseRequest.update({ where: { id: prId }, data: { status, updatedBy: ctx.userId } });
    return {
      result: after,
      audit: {
        action: `pr.approval.${decision.toLowerCase()}`,
        objectType: 'purchase_request',
        objectId: prId,
        before: { status: pr.status, slot: slotRole },
        after: { status, decidedBy: ctx.userId, comment: comment ?? null },
      },
    };
  });
}

export async function transitionPr(
  ctx: TenantContext,
  id: string,
  trigger: Exclude<PrTrigger, 'submit' | 'approve_complete' | 'reject' | 'fast_lane'>,
  options?: { comment?: string },
) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const pr = await findScopedOr404(tx.purchaseRequest, ctx, id);
    const payload = {
      isRequester: pr.requesterId === ctx.userId,
      isFinance: hasRole(ctx, 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE'),
      ...(options?.comment !== undefined ? { comment: options.comment } : {}),
    };
    const to = prMachine.assert(ctx, pr.status as PrStatus, trigger, payload);
    const after = await tx.purchaseRequest.update({
      where: { id },
      data: { status: to, updatedBy: ctx.userId },
    });
    return {
      result: after,
      audit: {
        action: `pr.${trigger}`,
        objectType: 'purchase_request',
        objectId: id,
        before: { status: pr.status },
        after: { status: to, comment: options?.comment ?? null },
      },
    };
  });
}

// ── Чтение ──

export async function listPrs(ctx: TenantContext, filter?: { status?: PrStatus; mine?: boolean }) {
  requirePermission(ctx, 'pr.view');
  // REQUESTER видит свои + свой cost center (docs/05)
  const requesterOnly = hasRole(ctx, 'REQUESTER') && !hasRole(ctx, 'OWNER', 'FINANCE_OPS_LEAD', 'JUNIOR_FINANCE', 'DOCUMENT_CONTROLLER', 'ACCOUNTANT', 'ADMIN');
  const ownCcIds = requesterOnly
    ? (await prisma.costCenter.findMany({ where: { tenantId: ctx.tenantId, ownerId: ctx.userId } })).map((c) => c.id)
    : [];
  return prisma.purchaseRequest.findMany({
    where: whereTenant(ctx, {
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.mine ? { requesterId: ctx.userId } : {}),
      ...(requesterOnly
        ? { OR: [{ requesterId: ctx.userId }, { costCenterId: { in: ownCcIds } }] }
        : {}),
    }),
    orderBy: { createdAt: 'desc' },
    include: { approvals: true },
  });
}

export async function getPr(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'pr.view');
  const pr = await findScopedOr404(prisma.purchaseRequest, ctx, id);
  const [approvals, audit, vendor, category, costCenter] = await Promise.all([
    prisma.purchaseApproval.findMany({ where: { prId: id }, orderBy: { createdAt: 'asc' } }),
    prisma.auditLog.findMany({
      where: { tenantId: ctx.tenantId, objectType: 'purchase_request', objectId: id },
      orderBy: { seq: 'asc' },
    }),
    pr.vendorId ? prisma.vendor.findUnique({ where: { id: pr.vendorId } }) : null,
    prisma.category.findUnique({ where: { id: pr.categoryId } }),
    prisma.costCenter.findUnique({ where: { id: pr.costCenterId } }),
  ]);
  return { pr, approvals, audit, vendor, category, costCenter };
}

/** Ожидающие решения текущего пользователя (для My Approvals). */
export async function listMyPendingApprovals(ctx: TenantContext) {
  const prs = await prisma.purchaseRequest.findMany({
    where: whereTenant(ctx, { status: 'SUBMITTED' as PrStatus }),
    include: { approvals: true },
    orderBy: { createdAt: 'asc' },
  });
  const result = [];
  for (const pr of prs) {
    for (const slot of pr.approvals.filter((a) => a.decision === null)) {
      try {
        await assertSlotPermission(ctx, pr, slot.role);
        result.push({ pr, slot });
      } catch {
        // нет права на этот слот — пропускаем
      }
    }
  }
  return result;
}
