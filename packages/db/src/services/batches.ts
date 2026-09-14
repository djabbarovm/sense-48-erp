/**
 * C-04/C-08: PaymentBatch (docs/04, D-13, BR-040/043/051/052/053/057).
 */
import { createHash } from 'node:crypto';
import type { BatchStatusCore, PaymentStatus, TenantContext } from '@finance-os/core';
import {
  SodViolationError,
  ValidationError,
  batchMachine,
  decryptSecret,
  hasRole,
  paymentMachine,
  requirePermission,
} from '@finance-os/core';
import type { BatchStatus, BatchType, PaymentRequest, Prisma } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { batchNumber } from '../sequence.js';

type Tx = Prisma.TransactionClient;

// ── Создание / состав ──

export async function createBatch(
  ctx: TenantContext,
  input: { bankAccountId: string; batchDate?: Date; type?: BatchType },
) {
  requirePermission(ctx, 'batch.create');
  const batchDate = input.batchDate ?? new Date();
  const type = input.type ?? 'STANDARD';
  const account = await prisma.bankAccount.findFirst({
    where: { id: input.bankAccountId, tenantId: ctx.tenantId, isActive: true },
  });
  if (!account) throw new ValidationError('BANK_ACCOUNT_NOT_FOUND');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    // BR-051: один STANDARD batch в день на счёт
    if (type === 'STANDARD') {
      const existing = await tx.paymentBatch.findFirst({
        where: {
          tenantId: ctx.tenantId,
          bankAccountId: input.bankAccountId,
          type: 'STANDARD',
          batchDate,
          status: { not: 'CANCELLED' },
        },
      });
      if (existing) {
        throw new ValidationError('BATCH_ALREADY_EXISTS', `STANDARD batch на ${batchDate.toISOString().slice(0, 10)} уже есть (BR-051): ${existing.number}`);
      }
    }
    let number = batchNumber(batchDate);
    if (type === 'URGENT') {
      const urgentCount = await tx.paymentBatch.count({
        where: { tenantId: ctx.tenantId, type: 'URGENT', batchDate },
      });
      number = batchNumber(batchDate, urgentCount + 1);
    }
    const created = await tx.paymentBatch.create({
      data: {
        tenantId: ctx.tenantId,
        number,
        type,
        batchDate,
        bankAccountId: input.bankAccountId,
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'batch.create',
        objectType: 'payment_batch',
        objectId: created.id,
        after: { number, type, batchDate: batchDate.toISOString().slice(0, 10) },
      },
    };
  });
}

async function refreshTotals(tx: Tx, batchId: string) {
  const agg = await tx.paymentRequest.aggregate({
    where: { batchId, status: { in: ['IN_BATCH', 'APPROVED', 'SENT_TO_BANK', 'PAID', 'FAILED', 'RECONCILED', 'CLOSED'] } },
    _sum: { requestedMinor: true },
    _count: true,
  });
  await tx.paymentBatch.update({
    where: { id: batchId },
    data: { totalMinor: agg._sum.requestedMinor ?? 0n, count: agg._count },
  });
}

/** BR-043: urgent-платёж попадает в batch только c approval роли из urgent_approver_roles. */
export async function addToBatch(ctx: TenantContext, batchId: string, paymentId: string) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const batch = await findScopedOr404(tx.paymentBatch, ctx, batchId);
    const payment = await findScopedOr404(tx.paymentRequest, ctx, paymentId);
    if (payment.isUrgent && batch.type === 'STANDARD') {
      // urgent после cutoff идёт отдельным URGENT batch (D-13); в STANDARD допускаем до cutoff
      const cutoff = await getCutoff(tx, ctx.tenantId, batch.batchDate);
      if (new Date() > cutoff) {
        throw new ValidationError('URGENT_AFTER_CUTOFF', 'После cutoff — только URGENT batch (BR-043)');
      }
    }
    if (batch.type === 'URGENT') {
      if (!payment.isUrgent) throw new ValidationError('NOT_URGENT', 'В URGENT batch — только urgent-платежи');
      if (!hasRole(ctx, 'OWNER', 'FINANCE_OPS_LEAD')) {
        throw new ValidationError('PERMISSION_DENIED:payment.urgent.approve', 'Urgent approve — Owner/Lead (BR-043)');
      }
      await tx.batchApproval.create({
        data: {
          tenantId: ctx.tenantId,
          batchId,
          approverId: ctx.userId,
          role: ctx.roles.join(','),
          scope: 'ITEM',
          paymentRequestId: paymentId,
          decision: 'APPROVED',
          comment: 'urgent approve (BR-043)',
        },
      });
      // BR-043: пост-review Task для Lead
      await tx.task.create({
        data: {
          tenantId: ctx.tenantId,
          type: 'REVIEW_EXCEPTION',
          objectType: 'payment_request',
          objectId: paymentId,
          nextAction: `Пост-review urgent-платежа ${payment.number} (${payment.urgencyReason ?? ''})`,
        },
      });
    }
    const to = paymentMachine.assert(ctx, payment.status as PaymentStatus, 'add_to_batch', {
      batchOpen: batch.status === 'OPEN',
    });
    await tx.paymentRequest.update({ where: { id: paymentId }, data: { status: to, batchId } });
    await refreshTotals(tx, batchId);
    return {
      result: await tx.paymentBatch.findUniqueOrThrow({ where: { id: batchId } }),
      audit: {
        action: 'batch.add_item',
        objectType: 'payment_batch',
        objectId: batchId,
        after: { paymentId, number: payment.number },
      },
    };
  });
}

export async function removeFromBatch(ctx: TenantContext, paymentId: string) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const payment = await findScopedOr404(tx.paymentRequest, ctx, paymentId);
    if (!payment.batchId) throw new ValidationError('NOT_IN_BATCH');
    const batch = await tx.paymentBatch.findUniqueOrThrow({ where: { id: payment.batchId } });
    const to = paymentMachine.assert(ctx, payment.status as PaymentStatus, 'remove_from_batch', {
      batchFrozen: batch.status !== 'OPEN',
    });
    await tx.paymentRequest.update({ where: { id: paymentId }, data: { status: to, batchId: null } });
    await refreshTotals(tx, batch.id);
    return {
      result: batch,
      audit: {
        action: 'batch.remove_item',
        objectType: 'payment_batch',
        objectId: batch.id,
        after: { paymentId },
      },
    };
  });
}

async function getCutoff(tx: Tx, tenantId: string, batchDate: Date): Promise<Date> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const cutoffTime = ((tenant.settings as Record<string, unknown>).cutoff_time as string) ?? '14:00';
  const [h, m] = cutoffTime.split(':').map(Number) as [number, number];
  const cutoff = new Date(batchDate);
  cutoff.setHours(h, m, 0, 0);
  return cutoff;
}

// ── Summary (D-13 / docs/06 §8, BR-053) ──

export interface BatchSummary {
  totalMinor: string;
  count: number;
  byCategory: Record<string, string>;
  byUrgency: { standard: number; urgent: number };
  byControl: Record<string, number>;
  cashBeforeMinor: string;
  cashAfterMinor: string;
  committedNext7dMinor: string;
  cashWarning: boolean;
  exceptions: { number: string; type: string; reason: string | null }[];
  relatedParty: string[]; // BR-036: выделяются в summary
}

async function buildSummary(tx: Tx, tenantId: string, batchId: string): Promise<BatchSummary> {
  const batch = await tx.paymentBatch.findUniqueOrThrow({ where: { id: batchId } });
  const items = await tx.paymentRequest.findMany({ where: { batchId } });
  const categories = new Map(
    (await tx.category.findMany({ where: { tenantId } })).map((c) => [c.id, c.name]),
  );
  const vendors = new Map(
    (await tx.vendor.findMany({ where: { tenantId } })).map((v) => [v.id, v]),
  );

  const byCategory: Record<string, bigint> = {};
  const byControl: Record<string, number> = {};
  const exceptions: BatchSummary['exceptions'] = [];
  const relatedParty: string[] = [];
  let urgent = 0;
  let total = 0n;

  for (const item of items) {
    total += item.requestedMinor;
    const cat = item.categoryId ? (categories.get(item.categoryId) ?? '—') : '—';
    byCategory[cat] = (byCategory[cat] ?? 0n) + item.requestedMinor;
    if (item.isUrgent) urgent++;
    for (const c of (item.controlsResult as { code: string; result: string }[] | null) ?? []) {
      if (c.result !== 'PASS') byControl[`${c.code}:${c.result}`] = (byControl[`${c.code}:${c.result}`] ?? 0) + 1;
    }
    if (item.exceptionType) {
      exceptions.push({ number: item.number, type: item.exceptionType, reason: item.exceptionReason });
    }
    const vendor = item.vendorId ? vendors.get(item.vendorId) : null;
    if (vendor?.riskFlags.includes('RELATED_PARTY')) relatedParty.push(`${item.number} → ${vendor.displayName}`);
  }

  // cash: opening balance счёта + все транзакции
  const account = await tx.bankAccount.findUniqueOrThrow({ where: { id: batch.bankAccountId } });
  const txAgg = await tx.bankTransaction.aggregate({
    where: { bankAccountId: batch.bankAccountId },
    _sum: { amountMinor: true },
  });
  const cashBefore = account.openingBalanceMinor + (txAgg._sum.amountMinor ?? 0n);
  // обязательства ближайших 7 дней вне этого batch
  const week = new Date(batch.batchDate);
  week.setDate(week.getDate() + 7);
  const committedAgg = await tx.paymentRequest.aggregate({
    where: {
      tenantId,
      batchId: { not: batchId },
      status: { in: ['READY_FOR_BATCH', 'IN_BATCH', 'APPROVED', 'SENT_TO_BANK'] },
      OR: [{ dueDate: { lte: week } }, { dueDate: null }],
    },
    _sum: { requestedMinor: true },
  });
  const committed7d = committedAgg._sum.requestedMinor ?? 0n;
  const cashAfter = cashBefore - total - committed7d;

  return {
    totalMinor: total.toString(),
    count: items.length,
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, v.toString()])),
    byUrgency: { standard: items.length - urgent, urgent },
    byControl,
    cashBeforeMinor: cashBefore.toString(),
    cashAfterMinor: cashAfter.toString(),
    committedNext7dMinor: committed7d.toString(),
    cashWarning: cashAfter < 0n, // BR-053 SOFT
    exceptions,
    relatedParty,
  };
}

// ── Переходы ──

export async function freezeBatch(ctx: TenantContext, batchId: string) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const batch = await findScopedOr404(tx.paymentBatch, ctx, batchId);
    const itemCount = await tx.paymentRequest.count({ where: { batchId, status: 'IN_BATCH' } });
    const to = batchMachine.assert(ctx, batch.status as BatchStatusCore, 'freeze', { itemCount });
    const summary = await buildSummary(tx, ctx.tenantId, batchId);
    const after = await tx.paymentBatch.update({
      where: { id: batchId },
      data: {
        status: to as BatchStatus,
        frozenBy: ctx.userId,
        cutoffAt: new Date(),
        summary: summary as unknown as Prisma.InputJsonValue,
        updatedBy: ctx.userId,
      },
    });
    return {
      result: after,
      audit: {
        action: 'batch.freeze',
        objectType: 'payment_batch',
        objectId: batchId,
        before: { status: batch.status },
        after: { status: to, total: summary.totalMinor, count: summary.count, cashWarning: summary.cashWarning },
      },
    };
  });
}

export async function unfreezeBatch(ctx: TenantContext, batchId: string) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const batch = await findScopedOr404(tx.paymentBatch, ctx, batchId);
    const to = batchMachine.assert(ctx, batch.status as BatchStatusCore, 'unfreeze', {});
    const after = await tx.paymentBatch.update({
      where: { id: batchId },
      data: { status: to as BatchStatus, frozenBy: null, updatedBy: ctx.userId },
    });
    return {
      result: after,
      audit: { action: 'batch.unfreeze', objectType: 'payment_batch', objectId: batchId, before: { status: batch.status }, after: { status: to } },
    };
  });
}

export async function reviewBatch(ctx: TenantContext, batchId: string) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const batch = await findScopedOr404(tx.paymentBatch, ctx, batchId);
    const to = batchMachine.assert(ctx, batch.status as BatchStatusCore, 'review', { frozenBy: batch.frozenBy });
    const after = await tx.paymentBatch.update({
      where: { id: batchId },
      data: { status: to as BatchStatus, reviewedBy: ctx.userId, updatedBy: ctx.userId },
    });
    await tx.batchApproval.create({
      data: {
        tenantId: ctx.tenantId,
        batchId,
        approverId: ctx.userId,
        role: 'FINANCE_OPS_LEAD',
        scope: 'BATCH',
        decision: 'APPROVED',
        comment: 'review (4-eyes)',
      },
    });
    return {
      result: after,
      audit: { action: 'batch.review', objectType: 'payment_batch', objectId: batchId, after: { status: to, reviewedBy: ctx.userId } },
    };
  });
}

/**
 * Approve batch [OWNER] (AC-07/AC-15): rejections — по номерам items c комментарием.
 * BR-040: approver ≠ prepared_by каждого утверждаемого item, иначе 403 SOD_VIOLATION.
 */
export async function approveBatch(
  ctx: TenantContext,
  batchId: string,
  rejections: { paymentId: string; comment: string }[] = [],
) {
  requirePermission(ctx, 'batch.approve');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const batch = await findScopedOr404(tx.paymentBatch, ctx, batchId);
    if (batch.status !== 'REVIEWED') {
      throw new ValidationError('BATCH_NOT_REVIEWED', `Approve только после review; сейчас ${batch.status}`);
    }
    const items = await tx.paymentRequest.findMany({ where: { batchId, status: 'IN_BATCH' } });
    const rejectedIds = new Set(rejections.map((r) => r.paymentId));
    // BR-045: reject требует комментарий
    for (const r of rejections) {
      if (!r.comment || r.comment.trim().length === 0) {
        throw new ValidationError('REJECT_COMMENT_REQUIRED', 'Reject item требует комментарий');
      }
    }
    // BR-040: four-eyes на каждом утверждаемом item
    for (const item of items) {
      if (rejectedIds.has(item.id)) continue;
      if (item.preparedBy && item.preparedBy === ctx.userId) {
        throw new SodViolationError(`SOD_VIOLATION: ${item.number} подготовлен утверждающим (BR-040)`);
      }
    }
    // применяем решения
    for (const item of items) {
      if (rejectedIds.has(item.id)) {
        const comment = rejections.find((r) => r.paymentId === item.id)!.comment;
        paymentMachine.assert(null, item.status as PaymentStatus, 'reject_item', { comment });
        await tx.paymentRequest.update({
          where: { id: item.id },
          data: { status: 'REJECTED', batchId: null },
        });
        await tx.batchApproval.create({
          data: {
            tenantId: ctx.tenantId,
            batchId,
            approverId: ctx.userId,
            role: 'OWNER',
            scope: 'ITEM',
            paymentRequestId: item.id,
            decision: 'REJECTED',
            comment,
          },
        });
      } else {
        await tx.paymentRequest.update({ where: { id: item.id }, data: { status: 'APPROVED' } });
        await tx.batchApproval.create({
          data: {
            tenantId: ctx.tenantId,
            batchId,
            approverId: ctx.userId,
            role: 'OWNER',
            scope: 'ITEM',
            paymentRequestId: item.id,
            decision: 'APPROVED',
          },
        });
      }
    }
    const partial = rejections.length > 0;
    const to = batchMachine.assert(ctx, batch.status as BatchStatusCore, partial ? 'approve_partial' : 'approve', {
      allItemsDecided: true,
    });
    const after = await tx.paymentBatch.update({
      where: { id: batchId },
      data: { status: to as BatchStatus, updatedBy: ctx.userId },
    });
    await refreshTotals(tx, batchId);
    return {
      result: after,
      audit: {
        action: 'batch.approve',
        objectType: 'payment_batch',
        objectId: batchId,
        after: { status: to, approved: items.length - rejections.length, rejected: rejections.length },
      },
    };
  });
}

// ── Экспорт (BR-057, docs/07 §1) ──

function bankDataKey(): string {
  const key = process.env.BANK_DATA_KEY;
  if (!key) throw new ValidationError('BANK_DATA_KEY_MISSING');
  return key;
}

/** Unified batch CSV: единственное место, где полный номер счёта попадает в вывод. */
export async function exportBatch(
  ctx: TenantContext,
  batchId: string,
  storage?: { put(key: string, body: Buffer, contentType: string): Promise<void> },
) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const batch = await findScopedOr404(tx.paymentBatch, ctx, batchId);
    const to = batchMachine.assert(ctx, batch.status as BatchStatusCore, 'export', {});
    const items = await tx.paymentRequest.findMany({
      where: { batchId, status: 'APPROVED' },
      orderBy: { number: 'asc' },
    });
    if (items.length === 0) throw new ValidationError('NO_APPROVED_ITEMS');
    const rows = ['payment_request_number;vendor_legal_name;vendor_tax_id;vendor_account;vendor_mfo;amount;currency;purpose;due_date'];
    for (const item of items) {
      const vendor = item.vendorId ? await tx.vendor.findUnique({ where: { id: item.vendorId } }) : null;
      const account = item.vendorBankAccountId
        ? await tx.vendorBankAccount.findUnique({ where: { id: item.vendorBankAccountId } })
        : null;
      const fullAccount = account ? decryptSecret(account.accountEncrypted, bankDataKey()) : '';
      const amount = `${item.requestedMinor / 100n}.${String(item.requestedMinor % 100n).padStart(2, '0')}`;
      rows.push(
        [
          item.number,
          vendor?.legalName ?? '',
          vendor?.taxId ?? '',
          fullAccount,
          account?.mfo ?? '',
          amount,
          item.currency,
          item.purposeNote.replaceAll(';', ','),
          item.dueDate?.toISOString().slice(0, 10) ?? '',
        ].join(';'),
      );
    }
    const csv = Buffer.from(rows.join('\n'), 'utf8');
    const sha256 = createHash('sha256').update(csv).digest('hex');
    const fileKey = `${ctx.tenantId}/batches/${batch.number}.csv`;
    if (storage) await storage.put(fileKey, csv, 'text/csv');
    const document = await tx.document.create({
      data: {
        tenantId: ctx.tenantId,
        objectType: 'payment_batch',
        objectId: batchId,
        docType: 'OTHER',
        fileKey,
        fileName: `${batch.number}.csv`,
        mime: 'text/csv',
        size: csv.length,
        sha256,
        uploadedBy: ctx.userId,
        status: 'RECEIVED',
      },
    });
    const after = await tx.paymentBatch.update({
      where: { id: batchId },
      data: { status: to as BatchStatus, exportFileDocumentId: document.id, updatedBy: ctx.userId },
    });
    return {
      result: { batch: after, csv, sha256 },
      audit: {
        action: 'batch.export',
        objectType: 'payment_batch',
        objectId: batchId,
        after: { status: to, sha256, items: items.length },
      },
    };
  });
}

export async function markBatchSent(ctx: TenantContext, batchId: string) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const batch = await findScopedOr404(tx.paymentBatch, ctx, batchId);
    const to = batchMachine.assert(ctx, batch.status as BatchStatusCore, 'mark_sent', {});
    const items = await tx.paymentRequest.findMany({ where: { batchId, status: 'APPROVED' } });
    for (const item of items) {
      paymentMachine.assert(ctx, item.status as PaymentStatus, 'mark_sent', {});
      await tx.paymentRequest.update({ where: { id: item.id }, data: { status: 'SENT_TO_BANK' } });
    }
    const after = await tx.paymentBatch.update({
      where: { id: batchId },
      data: { status: to as BatchStatus, updatedBy: ctx.userId },
    });
    return {
      result: after,
      audit: {
        action: 'batch.mark_sent',
        objectType: 'payment_batch',
        objectId: batchId,
        after: { status: to, items: items.length },
      },
    };
  });
}

/** Авто: SENT → SETTLED, когда все items PAID/FAILED (вызывается из reconciliation). */
export async function settleBatchIfDone(tx: Tx, tenantId: string, batchId: string): Promise<boolean> {
  const batch = await tx.paymentBatch.findFirst({ where: { id: batchId, tenantId } });
  if (!batch || batch.status !== 'SENT') return false;
  const undone = await tx.paymentRequest.count({
    where: { batchId, status: { notIn: ['PAID', 'FAILED', 'RECONCILED', 'CLOSED', 'REJECTED', 'CANCELLED'] } },
  });
  if (undone > 0) return false;
  batchMachine.assert(null, batch.status as BatchStatusCore, 'settle', {});
  await tx.paymentBatch.update({ where: { id: batchId }, data: { status: 'SETTLED' } });
  return true;
}

// ── Чтение ──

export async function listBatches(ctx: TenantContext) {
  requirePermission(ctx, 'payment.view');
  return prisma.paymentBatch.findMany({
    where: whereTenant(ctx),
    orderBy: { batchDate: 'desc' },
    take: 60,
  });
}

export async function getBatch(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'payment.view');
  const batch = await findScopedOr404(prisma.paymentBatch, ctx, id);
  const [items, approvals] = await Promise.all([
    prisma.paymentRequest.findMany({ where: { batchId: id }, orderBy: { number: 'asc' } }),
    prisma.batchApproval.findMany({ where: { batchId: id }, orderBy: { decidedAt: 'asc' } }),
  ]);
  return { batch, items, approvals };
}

export type { PaymentRequest };
