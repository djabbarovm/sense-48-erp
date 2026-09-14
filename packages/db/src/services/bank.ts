/**
 * C-06: импорт выписки + reconciliation (docs/07 §1, BR-054/055/056, BR-022).
 * PAID ставится ТОЛЬКО здесь — через ReconciliationMatch на BankTransaction.
 */
import type { ParsedBankRow } from '@finance-os/adapters';
import type { PaymentStatus, TenantContext } from '@finance-os/core';
import { NotFoundError, ValidationError, paymentMachine, requirePermission } from '@finance-os/core';
import type { BankTransaction, PaymentRequest, Prisma } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { settleBatchIfDone } from './batches.js';
import { createVendorPrepaymentAdvance } from './advances.js';

export interface BankImportReport {
  total: number;
  imported: number;
  skipped: number;
  autoMatched: number;
  suggested: number;
  unmatched: number;
  errors: { row: number; message: string }[];
}

/** BR-056: идемпотентный импорт — повтор external_id пропускается. */
export async function importBankStatement(
  ctx: TenantContext,
  bankAccountId: string,
  rows: ParsedBankRow[],
): Promise<BankImportReport> {
  requirePermission(ctx, 'bank.import');
  const account = await prisma.bankAccount.findFirst({
    where: { id: bankAccountId, tenantId: ctx.tenantId },
  });
  if (!account) throw new NotFoundError();

  const report: BankImportReport = { total: rows.length, imported: 0, skipped: 0, autoMatched: 0, suggested: 0, unmatched: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    try {
      const exists = await prisma.bankTransaction.findUnique({
        where: { bankAccountId_externalId: { bankAccountId, externalId: row.externalId } },
      });
      if (exists) {
        report.skipped++;
        continue;
      }
      const created = await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
        const transaction = await tx.bankTransaction.create({
          data: {
            tenantId: ctx.tenantId,
            bankAccountId,
            externalId: row.externalId,
            bookingDate: new Date(row.bookingDate),
            valueDate: new Date(row.valueDate),
            amountMinor: row.amountMinor,
            currency: row.currency,
            counterpartyName: row.counterpartyName,
            counterpartyTaxId: row.counterpartyTaxId ?? null,
            counterpartyAccountMasked: row.counterpartyAccountMasked ?? null,
            purposeText: row.purpose,
            raw: row.raw as Prisma.InputJsonValue,
          },
        });
        return {
          result: transaction,
          audit: {
            action: 'bank_transaction.import',
            objectType: 'bank_transaction',
            objectId: transaction.id,
            after: { externalId: row.externalId, amountMinor: row.amountMinor.toString() },
          },
        };
      });
      report.imported++;
      const matchResult = await autoMatchTransaction(ctx, created.id);
      if (matchResult === 'AUTO_MATCHED') report.autoMatched++;
      else if (matchResult === 'SUGGESTED') report.suggested++;
      else report.unmatched++;
    } catch (e) {
      report.errors.push({ row: i + 1, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return report;
}

/**
 * BR-055 / docs/07 §1: точный матч — tax_id совпал + сумма совпала +
 * PaymentRequest SENT_TO_BANK (±3 дня к batch_date) → AUTO_MATCHED + PAID.
 * Совпадение суммы или номера PAY в назначении → SUGGESTED. Иначе Task UNMATCHED_TX.
 */
export async function autoMatchTransaction(
  ctx: TenantContext,
  transactionId: string,
): Promise<'AUTO_MATCHED' | 'SUGGESTED' | 'UNMATCHED' | 'SKIPPED'> {
  const transaction = await prisma.bankTransaction.findFirst({
    where: { id: transactionId, tenantId: ctx.tenantId },
  });
  if (!transaction || transaction.matchStatus !== 'UNMATCHED') return 'SKIPPED';
  if (transaction.amountMinor >= 0n) {
    // IN-транзакции: матч на AR — Phase D-02; пока SUGGESTED не создаём
    return 'UNMATCHED';
  }
  const amount = -transaction.amountMinor;

  // кандидаты: SENT_TO_BANK на этого vendor
  const exact = transaction.counterpartyTaxId
    ? await prisma.paymentRequest.findFirst({
        where: {
          tenantId: ctx.tenantId,
          status: 'SENT_TO_BANK',
          requestedMinor: amount,
          vendorId: {
            in: (
              await prisma.vendor.findMany({
                where: { tenantId: ctx.tenantId, taxId: transaction.counterpartyTaxId },
                select: { id: true },
              })
            ).map((v) => v.id),
          },
        },
      })
    : null;

  if (exact) {
    await confirmPaidInternal(ctx, exact.id, transaction.id, 'AUTO');
    return 'AUTO_MATCHED';
  }

  // suggested: совпадение суммы у SENT_TO_BANK, либо номер PAY-… в назначении
  const payRef = transaction.purposeText.match(/PAY-\d{4}-\d{6}/)?.[0];
  const suggested = await prisma.paymentRequest.findFirst({
    where: {
      tenantId: ctx.tenantId,
      status: 'SENT_TO_BANK',
      OR: [{ requestedMinor: amount }, ...(payRef ? [{ number: payRef }] : [])],
    },
  });
  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const updated = await tx.bankTransaction.update({
      where: { id: transactionId },
      data: { matchStatus: suggested ? 'SUGGESTED' : 'UNMATCHED' },
    });
    if (!suggested) {
      await tx.task.create({
        data: {
          tenantId: ctx.tenantId,
          type: 'UNMATCHED_TX',
          objectType: 'bank_transaction',
          objectId: transactionId,
          nextAction: `Сопоставить списание ${amount / 100n} сум (${transaction.counterpartyName}) вручную или Ignore c причиной`,
        },
      });
    }
    return {
      result: updated,
      audit: {
        action: 'bank_transaction.match_status',
        objectType: 'bank_transaction',
        objectId: transactionId,
        after: { matchStatus: suggested ? 'SUGGESTED' : 'UNMATCHED', suggestedPayment: suggested?.number ?? null },
      },
    };
  });
  return suggested ? 'SUGGESTED' : 'UNMATCHED';
}

/** Единственный путь платежа в PAID (BR-054). BR-005: сумма matches ≤ |amount|. */
async function confirmPaidInternal(
  ctx: TenantContext,
  paymentId: string,
  transactionId: string,
  method: 'AUTO' | 'MANUAL',
): Promise<PaymentRequest> {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const payment = await findScopedOr404(tx.paymentRequest, ctx, paymentId);
    const transaction = await findScopedOr404(tx.bankTransaction, ctx, transactionId);
    paymentMachine.assert(null, payment.status as PaymentStatus, 'confirm_paid', {});
    // BR-054: сумма должна совпадать (±1% для FX)
    const txAmount = transaction.amountMinor < 0n ? -transaction.amountMinor : transaction.amountMinor;
    const diff = txAmount > payment.requestedMinor ? txAmount - payment.requestedMinor : payment.requestedMinor - txAmount;
    const tolerance = payment.currency === 'UZS' ? 0n : payment.requestedMinor / 100n;
    if (diff > tolerance) {
      throw new ValidationError('AMOUNT_MISMATCH', `Сумма транзакции ${txAmount} ≠ requested ${payment.requestedMinor} (BR-054)`);
    }
    // BR-005: сумма всех matches по транзакции ≤ |amount|
    const matched = await tx.reconciliationMatch.aggregate({
      where: { bankTransactionId: transactionId },
      _sum: { amountMinor: true },
    });
    if ((matched._sum.amountMinor ?? 0n) + payment.requestedMinor > txAmount) {
      throw new ValidationError('TX_OVERMATCHED', 'Сумма matches превышает сумму транзакции (BR-005)');
    }
    await tx.reconciliationMatch.create({
      data: {
        tenantId: ctx.tenantId,
        bankTransactionId: transactionId,
        objectType: 'PAYMENT_REQUEST',
        objectId: paymentId,
        amountMinor: payment.requestedMinor,
        matchedBy: method === 'MANUAL' ? ctx.userId : null,
        method,
        confidence: method === 'AUTO' ? '1.000' : null,
      },
    });
    const paid = await tx.paymentRequest.update({
      where: { id: paymentId },
      data: { status: 'PAID', bankTransactionId: transactionId, paidAt: transaction.bookingDate },
    });
    await tx.bankTransaction.update({
      where: { id: transactionId },
      data: { matchStatus: method === 'AUTO' ? 'AUTO_MATCHED' : 'MANUAL_MATCHED' },
    });
    // BR-022: prepayment → Advance + CLOSING_DOCS task
    if (paid.isPrepayment) {
      await createVendorPrepaymentAdvance(tx, ctx, paid);
    }
    // F-01/F-02: оплата налога/зарплаты двигает источник в PAID
    if (paid.sourceType === 'TAX_OBLIGATION') {
      await tx.taxObligation.updateMany({
        where: { id: paid.sourceId, tenantId: ctx.tenantId, status: { notIn: ['PAID', 'FILED'] } },
        data: { status: 'PAID' },
      });
    }
    if (paid.sourceType === 'PAYROLL_RUN') {
      await tx.payrollRun.updateMany({
        where: { id: paid.sourceId, tenantId: ctx.tenantId, status: 'APPROVED' },
        data: { status: 'PAID' },
      });
    }
    // PAID → RECONCILED, если after-payment документы не требуются (упрощение: не prepayment)
    let final = paid;
    if (!paid.isPrepayment) {
      paymentMachine.assert(null, 'PAID', 'reconcile', {});
      final = await tx.paymentRequest.update({ where: { id: paymentId }, data: { status: 'RECONCILED' } });
    }
    if (paid.batchId) await settleBatchIfDone(tx, ctx.tenantId, paid.batchId);
    return {
      result: final,
      audit: {
        action: 'payment_request.paid',
        objectType: 'payment_request',
        objectId: paymentId,
        before: { status: payment.status },
        after: { status: final.status, bankTransactionId: transactionId, method },
      },
    };
  });
}

/** Ручной матч (bank.reconcile.manual): junior сопоставляет unmatched/suggested транзакцию. */
export async function manualMatch(ctx: TenantContext, transactionId: string, paymentId: string) {
  requirePermission(ctx, 'bank.reconcile.manual');
  const result = await confirmPaidInternal(ctx, paymentId, transactionId, 'MANUAL');
  await prisma.task.updateMany({
    where: { tenantId: ctx.tenantId, objectType: 'bank_transaction', objectId: transactionId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    data: { status: 'DONE' },
  });
  return result;
}

/** FAILED path: банк отверг платёж (по выписке/ответу банка). */
export async function markPaymentFailed(ctx: TenantContext, paymentId: string, reason: string) {
  requirePermission(ctx, 'bank.reconcile.manual');
  if (!reason.trim()) throw new ValidationError('REASON_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const payment = await findScopedOr404(tx.paymentRequest, ctx, paymentId);
    const to = paymentMachine.assert(ctx, payment.status as PaymentStatus, 'bank_reject', {});
    const after = await tx.paymentRequest.update({ where: { id: paymentId }, data: { status: to } });
    await tx.task.create({
      data: {
        tenantId: ctx.tenantId,
        type: 'REVIEW_EXCEPTION',
        objectType: 'payment_request',
        objectId: paymentId,
        nextAction: `Платёж ${payment.number} отклонён банком: ${reason}. Пересоздать (recreate) после исправления`,
      },
    });
    if (payment.batchId) await settleBatchIfDone(tx, ctx.tenantId, payment.batchId);
    return {
      result: after,
      audit: {
        action: 'payment_request.bank_reject',
        objectType: 'payment_request',
        objectId: paymentId,
        before: { status: payment.status },
        after: { status: to, reason },
      },
    };
  });
}

export async function ignoreTransaction(ctx: TenantContext, transactionId: string, reason: string) {
  requirePermission(ctx, 'bank.reconcile.manual');
  if (!reason.trim()) throw new ValidationError('REASON_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const transaction = await findScopedOr404(tx.bankTransaction, ctx, transactionId);
    if (!['UNMATCHED', 'SUGGESTED'].includes(transaction.matchStatus)) {
      throw new ValidationError('TX_NOT_IGNORABLE');
    }
    const after = await tx.bankTransaction.update({
      where: { id: transactionId },
      data: { matchStatus: 'IGNORED' },
    });
    await tx.task.updateMany({
      where: { tenantId: ctx.tenantId, objectType: 'bank_transaction', objectId: transactionId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      data: { status: 'DONE' },
    });
    return {
      result: after,
      audit: {
        action: 'bank_transaction.ignore',
        objectType: 'bank_transaction',
        objectId: transactionId,
        after: { reason },
      },
    };
  });
}

// ── Чтение ──

export async function listBankTransactions(
  ctx: TenantContext,
  filter?: { matchStatus?: BankTransaction['matchStatus'][] },
) {
  requirePermission(ctx, 'bank.import');
  return prisma.bankTransaction.findMany({
    where: whereTenant(ctx, filter?.matchStatus ? { matchStatus: { in: filter.matchStatus } } : {}),
    orderBy: { bookingDate: 'desc' },
    take: 300,
  });
}

/** Cash position: opening + сумма транзакций (v_cash_position). */
export async function getCashPosition(ctx: TenantContext) {
  requirePermission(ctx, 'payment.view');
  const accounts = await prisma.bankAccount.findMany({ where: whereTenant(ctx, { isActive: true }) });
  const result = [];
  for (const account of accounts) {
    const agg = await prisma.bankTransaction.aggregate({
      where: { bankAccountId: account.id },
      _sum: { amountMinor: true },
    });
    result.push({
      account: { id: account.id, bankName: account.bankName, accountMasked: account.accountMasked, currency: account.currency },
      balanceMinor: account.openingBalanceMinor + (agg._sum.amountMinor ?? 0n),
    });
  }
  return result;
}
