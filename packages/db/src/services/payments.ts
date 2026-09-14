/**
 * C-01/C-02: PaymentRequest + run_controls() (docs/03 §A/B/C/D, docs/04).
 * Все контроли снимаются снапшотом в controls_result на момент submit (BR-050).
 */
import type { ControlResult, PaymentStatus, TenantContext } from '@finance-os/core';
import {
  NotFoundError,
  ValidationError,
  controlsSatisfied,
  hasRole,
  paymentMachine,
  requirePermission,
} from '@finance-os/core';
import type {
  PaymentExceptionType,
  PaymentRequest,
  PaymentSourceType,
  Prisma,
  UrgencyReason,
} from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { nextNumber } from '../sequence.js';
import { checkRequiredDocs } from './documents.js';
import { RISK_BANK_CHANGED, RISK_NEW, RISK_RELATED_PARTY } from './vendors.js';

// pending-статусы, которые резервируют остаток (BR-011)
const PENDING_STATUSES = ['SUBMITTED', 'DOCS_CHECK', 'ON_HOLD', 'READY_FOR_BATCH', 'IN_BATCH', 'APPROVED', 'SENT_TO_BANK'] as const;
const PAID_STATUSES = ['PAID', 'RECONCILED', 'CLOSED'] as const;

type Tx = Prisma.TransactionClient;

// ── Outstanding по источнику (BR-010/011) ──

async function sumPayments(tx: Tx, tenantId: string, sourceType: PaymentSourceType, sourceId: string, exceptId?: string) {
  const [paid, pending] = await Promise.all([
    tx.paymentRequest.aggregate({
      where: { tenantId, sourceType, sourceId, status: { in: [...PAID_STATUSES] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      _sum: { requestedMinor: true },
    }),
    tx.paymentRequest.aggregate({
      where: { tenantId, sourceType, sourceId, status: { in: [...PENDING_STATUSES] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      _sum: { requestedMinor: true },
    }),
  ]);
  return { paidMinor: paid._sum.requestedMinor ?? 0n, pendingMinor: pending._sum.requestedMinor ?? 0n };
}

export interface SourceInfo {
  grossMinor: bigint;
  outstandingMinor: bigint; // с вычетом PAID и pending (BR-011)
  vendorId: string | null;
  contractId: string | null;
  categoryId: string | null;
  costCenterId: string | null;
  eventId: string | null;
  invoice?: { id: string; status: string; matchStatus: string; prId: string | null; date: Date };
}

/** Источник платежа: существует в tenant, в допускающем оплату статусе (BR-001). */
export async function resolveSource(
  tx: Tx,
  tenantId: string,
  sourceType: PaymentSourceType,
  sourceId: string,
  exceptPaymentId?: string,
): Promise<SourceInfo> {
  const sums = await sumPayments(tx, tenantId, sourceType, sourceId, exceptPaymentId);
  const used = sums.paidMinor + sums.pendingMinor;
  switch (sourceType) {
    case 'INVOICE': {
      const invoice = await tx.invoice.findFirst({ where: { id: sourceId, tenantId } });
      if (!invoice) throw new NotFoundError('Source invoice not found');
      if (['CANCELLED'].includes(invoice.status)) {
        throw new ValidationError('SOURCE_NOT_PAYABLE', `Invoice в статусе ${invoice.status}`);
      }
      return {
        grossMinor: invoice.amountGrossMinor,
        outstandingMinor: invoice.amountGrossMinor - used,
        vendorId: invoice.vendorId,
        contractId: invoice.contractId,
        categoryId: null,
        costCenterId: null,
        eventId: null,
        invoice: { id: invoice.id, status: invoice.status, matchStatus: invoice.matchStatus, prId: invoice.prId, date: invoice.date },
      };
    }
    case 'PR': {
      const pr = await tx.purchaseRequest.findFirst({ where: { id: sourceId, tenantId } });
      if (!pr) throw new NotFoundError('Source PR not found');
      if (!['APPROVED', 'ORDERED', 'RECEIVED', 'INVOICED'].includes(pr.status)) {
        throw new ValidationError('SOURCE_NOT_PAYABLE', `PR в статусе ${pr.status}`);
      }
      return {
        grossMinor: pr.totalMinor,
        outstandingMinor: pr.totalMinor - used,
        vendorId: pr.vendorId,
        contractId: pr.contractId,
        categoryId: pr.categoryId,
        costCenterId: pr.costCenterId,
        eventId: pr.eventId,
      };
    }
    case 'CONTRACT': {
      const contract = await tx.contract.findFirst({ where: { id: sourceId, tenantId } });
      if (!contract) throw new NotFoundError('Source contract not found');
      if (!['ACTIVE', 'EXPIRING', 'AMENDING'].includes(contract.status)) {
        throw new ValidationError('SOURCE_NOT_PAYABLE', `Contract в статусе ${contract.status}`);
      }
      const limit = contract.limitMinor ?? 0n;
      return {
        grossMinor: limit,
        outstandingMinor: limit > 0n ? limit - used : 9_223_372_036_854_775_000n,
        vendorId: contract.vendorId,
        contractId: contract.id,
        categoryId: null,
        costCenterId: null,
        eventId: null,
      };
    }
    case 'ADVANCE': {
      const advance = await tx.advance.findFirst({ where: { id: sourceId, tenantId } });
      if (!advance) throw new NotFoundError('Source advance not found');
      return {
        grossMinor: advance.amountMinor,
        outstandingMinor: advance.amountMinor - used,
        vendorId: advance.vendorId,
        contractId: null,
        categoryId: null,
        costCenterId: advance.costCenterId,
        eventId: advance.eventId,
      };
    }
    // TAX_OBLIGATION / PAYROLL_RUN — Phase F; LOAN/BANK_FEE — свободная сумма
    default:
      return {
        grossMinor: 0n,
        outstandingMinor: 9_223_372_036_854_775_000n,
        vendorId: null,
        contractId: null,
        categoryId: null,
        costCenterId: null,
        eventId: null,
      };
  }
}

// ── run_controls (C-01) ──

export async function runControls(tx: Tx, ctx: TenantContext, pr: PaymentRequest): Promise<ControlResult[]> {
  const controls: ControlResult[] = [];
  const push = (code: ControlResult['code'], result: ControlResult['result'], detail?: string) =>
    controls.push({ code, result, ...(detail ? { detail } : {}) });

  // BR-001: source
  let source: SourceInfo;
  try {
    source = await resolveSource(tx, ctx.tenantId, pr.sourceType, pr.sourceId, pr.id);
    push('NO_SOURCE', 'PASS');
  } catch {
    push('NO_SOURCE', 'FAIL', 'Source object не найден или не допускает оплату');
    return controls;
  }

  // BR-002 связка: DUPLICATE_SUSPECT invoice нельзя оплачивать
  if (source.invoice && source.invoice.status === 'DUPLICATE_SUSPECT') {
    push('INVOICE_DUPLICATE_SUSPECT', 'FAIL', 'Счёт помечен как возможный дубликат (BR-002)');
  }

  // BR-031: только VERIFIED счёт
  if (pr.vendorId) {
    const account = pr.vendorBankAccountId
      ? await tx.vendorBankAccount.findFirst({ where: { id: pr.vendorBankAccountId, tenantId: ctx.tenantId } })
      : null;
    if (!account || account.status !== 'VERIFIED') {
      push('UNVERIFIED_BANK', 'FAIL', 'Счёт получателя не VERIFIED (BR-031)');
    } else {
      push('UNVERIFIED_BANK', 'PASS');
      // BR-033: смена реквизитов < 7 дней — маркер (Owner-approval добавляет политика)
      const changedRecently =
        account.verifiedAt && Date.now() - account.verifiedAt.getTime() < 7 * 24 * 3600 * 1000;
      if (changedRecently) push('BANK_CHANGED_RECENTLY', 'WARN', 'Реквизиты изменены < 7 дней назад (BR-033)');
    }
  }

  // BR-003: дубликат платежа (vendor + amount + due ±3 дня; без due — окно по created_at)
  if (pr.vendorId) {
    const window = 3 * 86400_000;
    const dup = await tx.paymentRequest.findFirst({
      where: {
        tenantId: ctx.tenantId,
        id: { not: pr.id },
        vendorId: pr.vendorId,
        requestedMinor: pr.requestedMinor,
        status: { notIn: ['CANCELLED', 'REJECTED', 'FAILED'] },
        ...(pr.dueDate
          ? { dueDate: { gte: new Date(pr.dueDate.getTime() - window), lte: new Date(pr.dueDate.getTime() + window) } }
          : {
              dueDate: null,
              createdAt: { gte: new Date(pr.createdAt.getTime() - window), lte: new Date(pr.createdAt.getTime() + window) },
              sourceId: pr.sourceId, // без сроков дубликатом считаем только повтор по тому же источнику
            }),
      },
    });
    if (dup) push('DUP_PAYMENT_SUSPECT', 'FAIL', `Похожий платёж ${dup.number} (BR-003)`);
    else push('DUP_PAYMENT_SUSPECT', 'PASS');
  }

  // BR-010/011: requested <= outstanding
  if (pr.requestedMinor > source.outstandingMinor) {
    push('OVER_OUTSTANDING', 'FAIL', `Запрошено больше остатка: ${pr.requestedMinor} > ${source.outstandingMinor} (BR-010)`);
  } else {
    push('OVER_OUTSTANDING', 'PASS');
  }

  // BR-012 / BR-026: contract limit и expiry
  const contractId = pr.sourceType === 'CONTRACT' ? pr.sourceId : source.contractId;
  if (contractId) {
    const contract = await tx.contract.findUnique({ where: { id: contractId } });
    if (contract) {
      if (['EXPIRED'].includes(contract.status)) {
        push('CONTRACT_EXPIRED', 'FAIL', `Договор ${contract.number} истёк (BR-026)`);
      }
      if (contract.limitMinor && contract.limitMinor > 0n) {
        const sums = await sumPayments(tx, ctx.tenantId, 'CONTRACT', contract.id, pr.id);
        const invoiceSums = await tx.paymentRequest.aggregate({
          where: {
            tenantId: ctx.tenantId,
            id: { not: pr.id },
            sourceType: { in: ['INVOICE', 'PR'] },
            status: { in: [...PAID_STATUSES, ...PENDING_STATUSES] },
            // платежи по счетам/PR этого договора
            OR: [
              { sourceId: { in: (await tx.invoice.findMany({ where: { contractId: contract.id }, select: { id: true } })).map((i) => i.id) } },
            ],
          },
          _sum: { requestedMinor: true },
        });
        const used = sums.paidMinor + sums.pendingMinor + (invoiceSums._sum.requestedMinor ?? 0n);
        if (used + pr.requestedMinor > contract.limitMinor) {
          push('CONTRACT_LIMIT', 'FAIL', `Лимит договора ${contract.number} превышен (BR-012)`);
        }
      }
    }
  }

  // BR-020/021: 4-way match для INVOICE-источника
  if (pr.sourceType === 'INVOICE' && source.invoice) {
    if (pr.isPrepayment) {
      // BR-021: receipt не нужен, но нужен договор с PREPAY-условиями
      const contract = contractId ? await tx.contract.findUnique({ where: { id: contractId } }) : null;
      const terms = contract?.paymentTerms as { type?: string } | null;
      if (!contract || terms?.type !== 'PREPAY_PCT') {
        push('NO_CONTRACT', 'FAIL', 'Prepayment требует договор с PREPAY-условиями (BR-021)');
      }
    } else {
      const vendor = pr.vendorId ? await tx.vendor.findUnique({ where: { id: pr.vendorId } }) : null;
      if (source.invoice.matchStatus !== 'MATCHED') {
        push('INVOICE_UNMATCHED', 'FAIL', 'Счёт не сопоставлен (BR-020)');
      }
      if (!source.invoice.prId) {
        push('NO_PR', 'FAIL', 'Нет связанной заявки (BR-020)');
      } else {
        const receipt = await tx.receipt.findFirst({
          where: { prId: source.invoice.prId, status: { in: ['FULL', 'PARTIAL'] } },
        });
        if (!receipt) push('NO_RECEIPT', 'FAIL', 'Нет приёмки по заявке (BR-020)');
      }
      if (vendor?.requiresContract && !contractId) {
        push('NO_CONTRACT', 'FAIL', 'Vendor требует договор (BR-020)');
      }
    }
    // BR-025: backdated счёт
    const age = Date.now() - source.invoice.date.getTime();
    if (age > 30 * 86400_000) push('BACKDATED', 'WARN', 'Счёт старше 30 дней (BR-025)');
  }

  // BR-023: обязательные документы BEFORE_PAYMENT
  if (pr.categoryId) {
    const category = await tx.category.findUnique({ where: { id: pr.categoryId } });
    if (category) {
      const missing = await checkRequiredDocs(ctx, {
        categoryGroup: category.group,
        paymentType: pr.isPrepayment ? 'PREPAY' : 'POSTPAY',
        phase: 'BEFORE_PAYMENT',
        objectType: 'payment_request',
        objectId: pr.id,
        alsoObjects: [
          ...(source.invoice ? [{ objectType: 'invoice', objectId: source.invoice.id }] : []),
          ...(pr.sourceType === 'PR' ? [{ objectType: 'purchase_request', objectId: pr.sourceId }] : []),
          ...(source.invoice?.prId ? [{ objectType: 'purchase_request', objectId: source.invoice.prId }] : []),
          ...(contractId ? [{ objectType: 'contract', objectId: contractId }] : []),
        ],
      });
      for (const m of missing) push(m.control as ControlResult['code'], 'FAIL', `Нет документа ${m.docType} (BR-023)`);
      // UNBUDGETED
      if (category.budgetRequired && pr.costCenterId) {
        const period = new Date().toISOString().slice(0, 7);
        const budget = await tx.budget.findUnique({
          where: {
            tenantId_period_costCenterId_categoryId: {
              tenantId: ctx.tenantId,
              period,
              costCenterId: pr.costCenterId,
              categoryId: pr.categoryId,
            },
          },
        });
        if (!budget) push('UNBUDGETED', 'FAIL', 'Нет строки бюджета для обязательной категории (BR-014)');
      }
    }
  }

  // Риск-флаги vendor → WARN (Owner-эскалация через политику, BR-035/036)
  if (pr.vendorId) {
    const vendor = await tx.vendor.findUnique({ where: { id: pr.vendorId } });
    if (vendor?.riskFlags.includes(RISK_RELATED_PARTY)) push('RELATED_PARTY', 'WARN', 'Связанная сторона (BR-036)');
    if (vendor?.riskFlags.includes(RISK_NEW)) push('NEW_VENDOR', 'WARN', 'Новый vendor < 90 дней (BR-035)');
    if (vendor?.riskFlags.includes(RISK_BANK_CHANGED) && !controls.some((c) => c.code === 'BANK_CHANGED_RECENTLY')) {
      push('BANK_CHANGED_RECENTLY', 'WARN', 'Недавняя смена реквизитов (BR-030)');
    }
  }

  return controls;
}

// ── CRUD / workflow ──

export interface PaymentInput {
  sourceType: PaymentSourceType;
  sourceId: string;
  requestedMinor: bigint;
  currency?: string;
  purposeNote: string;
  vendorBankAccountId?: string | null;
  dueDate?: Date | null;
  isPrepayment?: boolean;
  isUrgent?: boolean;
  urgencyReason?: UrgencyReason | null;
}

export async function createPaymentRequest(ctx: TenantContext, input: PaymentInput) {
  requirePermission(ctx, 'payment.create');
  if (input.requestedMinor <= 0n) throw new ValidationError('AMOUNT_INVALID');
  if (!input.sourceId) throw new ValidationError('NO_SOURCE', 'Платёж без source object запрещён (BR-001)');
  if (input.isUrgent && !input.urgencyReason) {
    throw new ValidationError('URGENCY_REASON_REQUIRED', 'Urgent требует urgency_reason (BR-043)');
  }
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const source = await resolveSource(tx, ctx.tenantId, input.sourceType, input.sourceId);
    // счёт по умолчанию: VERIFIED default vendor'а
    let accountId = input.vendorBankAccountId ?? null;
    if (!accountId && source.vendorId) {
      const account = await tx.vendorBankAccount.findFirst({
        where: { vendorId: source.vendorId, status: 'VERIFIED', isDefault: true, currency: input.currency ?? 'UZS' },
      });
      accountId = account?.id ?? null;
    }
    const number = await nextNumber(tx, ctx.tenantId, 'PAY');
    const created = await tx.paymentRequest.create({
      data: {
        tenantId: ctx.tenantId,
        number,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        vendorId: source.vendorId,
        vendorBankAccountId: accountId,
        requestedMinor: input.requestedMinor,
        currency: input.currency ?? 'UZS',
        purposeNote: input.purposeNote,
        costCenterId: source.costCenterId,
        categoryId: source.categoryId,
        eventId: source.eventId,
        dueDate: input.dueDate ?? null,
        isPrepayment: input.isPrepayment ?? false,
        isUrgent: input.isUrgent ?? false,
        urgencyReason: input.urgencyReason ?? null,
        preparedBy: ctx.userId,
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'payment_request.create',
        objectType: 'payment_request',
        objectId: created.id,
        after: {
          number,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          requestedMinor: input.requestedMinor.toString(),
        },
      },
    };
  });
}

/** Submit → DOCS_CHECK (run_controls) → READY_FOR_BATCH | ON_HOLD (+Task) — docs/04. */
export async function submitPaymentRequest(ctx: TenantContext, id: string) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const pr = await findScopedOr404(tx.paymentRequest, ctx, id);
    paymentMachine.assert(ctx, pr.status as PaymentStatus, 'submit', {});
    const controls = await runControls(tx, ctx, pr);
    const exception =
      pr.exceptionType && pr.exceptionApprovedBy ? { type: pr.exceptionType } : null;
    const satisfied = controlsSatisfied(controls, exception);
    const status: PaymentStatus = satisfied ? 'READY_FOR_BATCH' : 'ON_HOLD';
    const after = await tx.paymentRequest.update({
      where: { id },
      data: {
        status,
        controlsResult: controls as unknown as Prisma.InputJsonValue,
        updatedBy: ctx.userId,
      },
    });
    if (!satisfied) {
      const fails = controls.filter((c) => c.result === 'FAIL');
      await tx.task.create({
        data: {
          tenantId: ctx.tenantId,
          type: fails.some((f) => f.code.startsWith('MISSING_DOC')) ? 'MISSING_DOC' : 'REVIEW_EXCEPTION',
          objectType: 'payment_request',
          objectId: id,
          nextAction: `Платёж ${pr.number} заблокирован: ${fails.map((f) => f.code).join(', ')}. ${fails[0]?.detail ?? ''} Эскалация: FINANCE_OPS_LEAD`,
          createdBy: ctx.userId,
        },
      });
    }
    return {
      result: { payment: after, controls },
      audit: {
        action: 'payment_request.submit',
        objectType: 'payment_request',
        objectId: id,
        before: { status: pr.status },
        after: { status, controls: controls.map((c) => `${c.code}=${c.result}`) },
      },
    };
  });
}

/** C-02: approve exception (Owner/Lead) → пере-прогон контролей → READY (BR-010 exception, BR-050). */
export async function approvePaymentException(
  ctx: TenantContext,
  id: string,
  exceptionType: PaymentExceptionType,
  reason: string,
) {
  requirePermission(ctx, 'payment.exception.approve');
  if (!reason || reason.trim().length < 5) throw new ValidationError('REASON_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const pr = await findScopedOr404(tx.paymentRequest, ctx, id);
    if (!['ON_HOLD', 'DOCS_CHECK', 'SUBMITTED', 'DRAFT'].includes(pr.status)) {
      throw new ValidationError('EXCEPTION_NOT_APPLICABLE', `Статус ${pr.status}`);
    }
    let updated = await tx.paymentRequest.update({
      where: { id },
      data: {
        exceptionType,
        exceptionReason: reason,
        exceptionApprovedBy: ctx.userId,
        updatedBy: ctx.userId,
      },
    });
    // ON_HOLD → resolve → DOCS_CHECK → пере-прогон
    if (pr.status === 'ON_HOLD') {
      const controls = await runControls(tx, ctx, updated);
      const satisfied = controlsSatisfied(controls, { type: exceptionType });
      updated = await tx.paymentRequest.update({
        where: { id },
        data: {
          status: satisfied ? 'READY_FOR_BATCH' : 'ON_HOLD',
          controlsResult: controls as unknown as Prisma.InputJsonValue,
        },
      });
      if (satisfied) {
        await tx.task.updateMany({
          where: { tenantId: ctx.tenantId, objectType: 'payment_request', objectId: id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
          data: { status: 'DONE' },
        });
      }
    }
    return {
      result: updated,
      audit: {
        action: 'payment_request.exception_approved',
        objectType: 'payment_request',
        objectId: id,
        after: { exceptionType, reason, approvedBy: ctx.userId, status: updated.status },
      },
    };
  });
}

/** ON_HOLD → resolve (после загрузки документов) → пере-прогон контролей. */
export async function resolvePaymentHold(ctx: TenantContext, id: string) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const pr = await findScopedOr404(tx.paymentRequest, ctx, id);
    paymentMachine.assert(ctx, pr.status as PaymentStatus, 'resolve', {});
    const controls = await runControls(tx, ctx, pr);
    const exception = pr.exceptionType && pr.exceptionApprovedBy ? { type: pr.exceptionType } : null;
    const satisfied = controlsSatisfied(controls, exception);
    const after = await tx.paymentRequest.update({
      where: { id },
      data: {
        status: satisfied ? 'READY_FOR_BATCH' : 'ON_HOLD',
        controlsResult: controls as unknown as Prisma.InputJsonValue,
        updatedBy: ctx.userId,
      },
    });
    if (satisfied) {
      await tx.task.updateMany({
        where: { tenantId: ctx.tenantId, objectType: 'payment_request', objectId: id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        data: { status: 'DONE' },
      });
    }
    return {
      result: { payment: after, controls },
      audit: {
        action: 'payment_request.resolve',
        objectType: 'payment_request',
        objectId: id,
        before: { status: pr.status },
        after: { status: after.status },
      },
    };
  });
}

export async function cancelPaymentRequest(ctx: TenantContext, id: string, comment: string) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const pr = await findScopedOr404(tx.paymentRequest, ctx, id);
    const to = paymentMachine.assert(ctx, pr.status as PaymentStatus, 'cancel', {
      isCreator: pr.createdBy === ctx.userId,
      isLead: hasRole(ctx, 'FINANCE_OPS_LEAD', 'OWNER'),
      comment,
    });
    const after = await tx.paymentRequest.update({ where: { id }, data: { status: to, updatedBy: ctx.userId } });
    return {
      result: after,
      audit: {
        action: 'payment_request.cancel',
        objectType: 'payment_request',
        objectId: id,
        before: { status: pr.status },
        after: { status: to, comment },
      },
    };
  });
}

// ── Чтение ──

export async function listPayments(ctx: TenantContext, filter?: { status?: PaymentStatus[] }) {
  requirePermission(ctx, 'payment.view');
  return prisma.paymentRequest.findMany({
    where: whereTenant(ctx, filter?.status ? { status: { in: filter.status as never } } : {}),
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export async function getPayment(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'payment.view');
  const payment = await findScopedOr404(prisma.paymentRequest, ctx, id);
  const [vendor, account, audit] = await Promise.all([
    payment.vendorId ? prisma.vendor.findUnique({ where: { id: payment.vendorId } }) : null,
    payment.vendorBankAccountId
      ? prisma.vendorBankAccount.findUnique({
          where: { id: payment.vendorBankAccountId },
          select: { id: true, bankName: true, accountMasked: true, status: true },
        })
      : null,
    prisma.auditLog.findMany({
      where: { tenantId: ctx.tenantId, objectType: 'payment_request', objectId: id },
      orderBy: { seq: 'asc' },
    }),
  ]);
  return { payment, vendor, account, audit };
}
