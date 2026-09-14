/**
 * B-07: PurchaseOrder + Receipt (docs/02 §4, BR-042, D-16).
 */
import type { AuditEntry, TenantContext } from '@finance-os/core';
import {
  NotFoundError,
  ValidationError,
  prMachine,
  requirePermission,
  type PrStatus,
} from '@finance-os/core';
import type { PoStatus, Prisma, ReceiptStatus } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404 } from '../repository.js';
import { nextNumber } from '../sequence.js';

// ── PurchaseOrder ──

export async function createPo(
  ctx: TenantContext,
  prId: string,
  input?: { lines?: { desc: string; qty: number; valueMinor: string }[] },
) {
  requirePermission(ctx, 'po.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const pr = await findScopedOr404(tx.purchaseRequest, ctx, prId);
    if (!pr.vendorId) throw new ValidationError('PO_REQUIRES_VENDOR', 'PO создаётся только для PR с поставщиком');
    const to = prMachine.assert(ctx, pr.status as PrStatus, 'create_po', {});
    const number = await nextNumber(tx, ctx.tenantId, 'PO');
    const po = await tx.purchaseOrder.create({
      data: {
        tenantId: ctx.tenantId,
        number,
        prId,
        vendorId: pr.vendorId,
        contractId: pr.contractId,
        lines: (input?.lines ?? []) as Prisma.InputJsonValue,
        totalMinor: pr.totalMinor,
        status: 'SENT',
        createdBy: ctx.userId,
      },
    });
    await tx.purchaseRequest.update({ where: { id: prId }, data: { status: to, updatedBy: ctx.userId } });
    return {
      result: po,
      audit: [
        {
          action: 'po.create',
          objectType: 'purchase_order',
          objectId: po.id,
          after: { number, prId, totalMinor: po.totalMinor.toString() },
        },
        {
          action: 'pr.create_po',
          objectType: 'purchase_request',
          objectId: prId,
          before: { status: pr.status },
          after: { status: to, poNumber: number },
        },
      ],
    };
  });
}

export async function setPoStatus(ctx: TenantContext, poId: string, status: PoStatus) {
  requirePermission(ctx, 'po.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const po = await findScopedOr404(tx.purchaseOrder, ctx, poId);
    const allowed: Record<PoStatus, PoStatus[]> = {
      DRAFT: ['SENT', 'CANCELLED'],
      SENT: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['CANCELLED'],
      CANCELLED: [],
    };
    if (!allowed[po.status].includes(status)) {
      throw new ValidationError('PO_TRANSITION_INVALID', `${po.status} → ${status}`);
    }
    const after = await tx.purchaseOrder.update({ where: { id: poId }, data: { status, updatedBy: ctx.userId } });
    return {
      result: after,
      audit: {
        action: 'po.status',
        objectType: 'purchase_order',
        objectId: poId,
        before: { status: po.status },
        after: { status },
      },
    };
  });
}

// ── Receipt ──

export interface ReceiptInput {
  prId: string;
  lines?: { desc: string; qty: number; valueMinor: string }[];
  status?: ReceiptStatus; // FULL по умолчанию
  evidenceDocumentIds?: string[];
}

/**
 * BR-042 / D-16: для Tier 2+ приёмщик ≠ инициатор PR. Для Tier 1 допускается
 * requester = receiver. FULL receipt переводит PR в RECEIVED.
 */
export async function createReceipt(ctx: TenantContext, input: ReceiptInput) {
  requirePermission(ctx, 'receipt.create');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const pr = await findScopedOr404(tx.purchaseRequest, ctx, input.prId);
    if (!['APPROVED', 'ORDERED'].includes(pr.status)) {
      throw new ValidationError('PR_NOT_RECEIVABLE', `Receipt по PR в статусе ${pr.status} невозможен`);
    }
    const tier = pr.tier ?? 1;
    if (tier >= 2 && pr.requesterId === ctx.userId) {
      throw new ValidationError(
        'SOD_VIOLATION',
        'Приёмку для Tier 2+ выполняет не инициатор заявки (BR-042, D-16)',
      );
    }
    const status = input.status ?? 'FULL';
    const po = await tx.purchaseOrder.findFirst({ where: { prId: input.prId, status: { not: 'CANCELLED' } } });
    const receipt = await tx.receipt.create({
      data: {
        tenantId: ctx.tenantId,
        prId: input.prId,
        poId: po?.id ?? null,
        receiverId: ctx.userId,
        lines: (input.lines ?? []) as Prisma.InputJsonValue,
        evidenceDocumentIds: input.evidenceDocumentIds ?? [],
        status,
        createdBy: ctx.userId,
      },
    });
    const audits: AuditEntry[] = [
      {
        action: 'receipt.create',
        objectType: 'receipt',
        objectId: receipt.id,
        after: { prId: input.prId, status, receiverId: ctx.userId },
      },
    ];
    let updatedPr = pr;
    if (status === 'FULL') {
      const to = prMachine.assert(ctx, pr.status as PrStatus, 'receipt_full', {});
      updatedPr = await tx.purchaseRequest.update({
        where: { id: input.prId },
        data: { status: to, updatedBy: ctx.userId },
      });
      audits.push({
        action: 'pr.receipt_full',
        objectType: 'purchase_request',
        objectId: input.prId,
        after: { status: to, receiptId: receipt.id },
      });
    }
    return { result: { receipt, pr: updatedPr }, audit: audits };
  });
}

export async function listReceiptsForPr(ctx: TenantContext, prId: string) {
  requirePermission(ctx, 'pr.view');
  const pr = await prisma.purchaseRequest.findFirst({ where: { id: prId, tenantId: ctx.tenantId } });
  if (!pr) throw new NotFoundError();
  return prisma.receipt.findMany({ where: { prId }, orderBy: { receivedAt: 'desc' } });
}

export async function getPoForPr(ctx: TenantContext, prId: string) {
  return prisma.purchaseOrder.findFirst({
    where: { prId, tenantId: ctx.tenantId, status: { not: 'CANCELLED' } },
  });
}
