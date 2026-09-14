/**
 * D-02: CustomerInvoice (AR) — выставление, поступления через банк,
 * dispute/promise, AR aging, reminders job (BR-060).
 */
import type { TenantContext } from '@finance-os/core';
import { NotFoundError, ValidationError, requirePermission } from '@finance-os/core';
import type { CustomerInvoiceStatus } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { nextNumber } from '../sequence.js';
import { bucketOf, type ApBucket } from './aging.js';

const OPEN_AR_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'DISPUTED'] as const;

export interface CustomerInvoiceInput {
  customerId: string;
  date: Date;
  dueDate?: Date; // default: date + customer.paymentTermsDays
  amountGrossMinor: bigint;
  vatMinor?: bigint;
  currency?: string;
  contractId?: string | null;
  eventId?: string | null;
}

export async function createCustomerInvoice(ctx: TenantContext, input: CustomerInvoiceInput) {
  requirePermission(ctx, 'ar.invoice.manage');
  if (input.amountGrossMinor <= 0n) throw new ValidationError('AMOUNT_INVALID');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId } });
    if (!customer) throw new NotFoundError('Customer not found');
    const dueDate = input.dueDate ?? new Date(input.date.getTime() + customer.paymentTermsDays * 86400_000);
    const number = await nextNumber(tx, ctx.tenantId, 'CINV', input.date);
    const created = await tx.customerInvoice.create({
      data: {
        tenantId: ctx.tenantId,
        number,
        customerId: input.customerId,
        contractId: input.contractId ?? null,
        eventId: input.eventId ?? null,
        date: input.date,
        dueDate,
        amountGrossMinor: input.amountGrossMinor,
        vatMinor: input.vatMinor ?? 0n,
        currency: input.currency ?? 'UZS',
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'customer_invoice.create',
        objectType: 'customer_invoice',
        objectId: created.id,
        after: { number, customerId: input.customerId, amountGrossMinor: input.amountGrossMinor.toString() },
      },
    };
  });
}

/** DRAFT → ISSUED: с этого момента работают reminders (BR-060). */
export async function issueCustomerInvoice(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'ar.invoice.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const invoice = await findScopedOr404(tx.customerInvoice, ctx, id);
    if (invoice.status !== 'DRAFT') throw new ValidationError('NOT_DRAFT', `Статус ${invoice.status}`);
    const after = await tx.customerInvoice.update({ where: { id }, data: { status: 'ISSUED', updatedBy: ctx.userId } });
    return {
      result: after,
      audit: { action: 'customer_invoice.issue', objectType: 'customer_invoice', objectId: id, before: { status: 'DRAFT' }, after: { status: 'ISSUED' } },
    };
  });
}

/**
 * Поступление по счёту через банковскую IN-транзакцию (единственный путь к PAID,
 * симметрично BR-054): ReconciliationMatch(AR_INVOICE) + received_minor.
 */
export async function matchArReceipt(ctx: TenantContext, transactionId: string, customerInvoiceId: string) {
  requirePermission(ctx, 'bank.reconcile.manual');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const transaction = await findScopedOr404(tx.bankTransaction, ctx, transactionId);
    const invoice = await findScopedOr404(tx.customerInvoice, ctx, customerInvoiceId);
    if (transaction.amountMinor <= 0n) throw new ValidationError('NOT_INBOUND', 'AR-матч только для зачислений');
    if (!['UNMATCHED', 'SUGGESTED'].includes(transaction.matchStatus)) {
      throw new ValidationError('TX_ALREADY_MATCHED');
    }
    if (!(OPEN_AR_STATUSES as readonly string[]).includes(invoice.status)) {
      throw new ValidationError('AR_NOT_OPEN', `Статус счёта ${invoice.status}`);
    }
    const received = invoice.receivedMinor + transaction.amountMinor;
    if (received > invoice.amountGrossMinor) {
      throw new ValidationError('OVERPAID', 'Поступление больше остатка по счёту');
    }
    await tx.reconciliationMatch.create({
      data: {
        tenantId: ctx.tenantId,
        bankTransactionId: transactionId,
        objectType: 'AR_INVOICE',
        objectId: customerInvoiceId,
        amountMinor: transaction.amountMinor,
        matchedBy: ctx.userId,
        method: 'MANUAL',
      },
    });
    await tx.bankTransaction.update({ where: { id: transactionId }, data: { matchStatus: 'MANUAL_MATCHED' } });
    const status: CustomerInvoiceStatus = received === invoice.amountGrossMinor ? 'PAID' : 'PARTIALLY_PAID';
    const after = await tx.customerInvoice.update({
      where: { id: customerInvoiceId },
      data: { receivedMinor: received, status, updatedBy: ctx.userId },
    });
    await tx.task.updateMany({
      where: { tenantId: ctx.tenantId, objectType: 'bank_transaction', objectId: transactionId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      data: { status: 'DONE' },
    });
    return {
      result: after,
      audit: {
        action: 'customer_invoice.receipt',
        objectType: 'customer_invoice',
        objectId: customerInvoiceId,
        before: { receivedMinor: invoice.receivedMinor.toString(), status: invoice.status },
        after: { receivedMinor: received.toString(), status, transactionId },
      },
    };
  });
}

export async function disputeCustomerInvoice(ctx: TenantContext, id: string, reason: string) {
  requirePermission(ctx, 'ar.dispute');
  if (!reason.trim()) throw new ValidationError('REASON_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const invoice = await findScopedOr404(tx.customerInvoice, ctx, id);
    if (!(OPEN_AR_STATUSES as readonly string[]).includes(invoice.status)) {
      throw new ValidationError('AR_NOT_OPEN', `Статус ${invoice.status}`);
    }
    const after = await tx.customerInvoice.update({
      where: { id },
      data: { status: 'DISPUTED', disputeReason: reason, updatedBy: ctx.userId },
    });
    return {
      result: after,
      audit: { action: 'customer_invoice.dispute', objectType: 'customer_invoice', objectId: id, before: { status: invoice.status }, after: { status: 'DISPUTED', reason } },
    };
  });
}

export async function promiseToPay(ctx: TenantContext, id: string, date: Date) {
  requirePermission(ctx, 'ar.invoice.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    await findScopedOr404(tx.customerInvoice, ctx, id);
    const after = await tx.customerInvoice.update({
      where: { id },
      data: { promiseToPayDate: date, updatedBy: ctx.userId },
    });
    return {
      result: after,
      audit: {
        action: 'customer_invoice.promise',
        objectType: 'customer_invoice',
        objectId: id,
        after: { promiseToPayDate: date.toISOString().slice(0, 10) },
      },
    };
  });
}

export async function cancelCustomerInvoice(ctx: TenantContext, id: string, reason: string) {
  requirePermission(ctx, 'ar.invoice.manage');
  if (!reason.trim()) throw new ValidationError('REASON_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const invoice = await findScopedOr404(tx.customerInvoice, ctx, id);
    if (invoice.receivedMinor > 0n) throw new ValidationError('HAS_RECEIPTS', 'По счёту были поступления');
    const after = await tx.customerInvoice.update({ where: { id }, data: { status: 'CANCELLED', updatedBy: ctx.userId } });
    return {
      result: after,
      audit: { action: 'customer_invoice.cancel', objectType: 'customer_invoice', objectId: id, before: { status: invoice.status }, after: { status: 'CANCELLED', reason } },
    };
  });
}

// ── AR aging (v_ar_aging) ──

export interface ArAgingRow {
  customerId: string;
  customerName: string;
  buckets: Record<ApBucket, bigint>;
  totalMinor: bigint;
  invoices: {
    invoiceId: string;
    number: string;
    dueDate: Date;
    bucket: ApBucket;
    outstandingMinor: bigint;
    status: CustomerInvoiceStatus;
    promiseToPayDate: Date | null;
  }[];
}

export async function getArAging(ctx: TenantContext, now = new Date()): Promise<ArAgingRow[]> {
  requirePermission(ctx, 'payment.view');
  const invoices = await prisma.customerInvoice.findMany({
    where: whereTenant(ctx, { status: { in: [...OPEN_AR_STATUSES] } }),
    orderBy: { dueDate: 'asc' },
  });
  if (invoices.length === 0) return [];
  const customers = new Map(
    (
      await prisma.customer.findMany({
        where: { tenantId: ctx.tenantId, id: { in: [...new Set(invoices.map((i) => i.customerId))] } },
        select: { id: true, legalName: true },
      })
    ).map((c) => [c.id, c.legalName]),
  );
  const rows = new Map<string, ArAgingRow>();
  for (const invoice of invoices) {
    const outstanding = invoice.amountGrossMinor - invoice.receivedMinor;
    if (outstanding <= 0n) continue;
    const bucket = bucketOf(invoice.dueDate, now);
    let row = rows.get(invoice.customerId);
    if (!row) {
      row = {
        customerId: invoice.customerId,
        customerName: customers.get(invoice.customerId) ?? '—',
        buckets: { NOT_DUE: 0n, D1_7: 0n, D8_30: 0n, D31_60: 0n, D60_PLUS: 0n },
        totalMinor: 0n,
        invoices: [],
      };
      rows.set(invoice.customerId, row);
    }
    row.buckets[bucket] += outstanding;
    row.totalMinor += outstanding;
    row.invoices.push({
      invoiceId: invoice.id,
      number: invoice.number,
      dueDate: invoice.dueDate,
      bucket,
      outstandingMinor: outstanding,
      status: invoice.status,
      promiseToPayDate: invoice.promiseToPayDate,
    });
  }
  return [...rows.values()].sort((a, b) => (a.totalMinor > b.totalMinor ? -1 : 1));
}

// ── Jobs (BR-060, D-05) ──

export const AR_REMINDER_OFFSETS = [-3, 0, 1, 3, 7] as const;

export interface ArReminderNotification {
  customerInvoiceId: string;
  number: string;
  offsetDays: number;
  arOwnerId: string | null;
}

/**
 * BR-060: reminders T−3/T0/+1/+3/+7 от due_date для ISSUED/PARTIALLY_PAID/OVERDUE.
 * Идемпотентен: unique(customer_invoice_id, offset_days). Возвращает список для
 * NotificationAdapter (Telegram AR owner — без сумм в чате, BR-072).
 */
export async function runArReminders(tenantId: string, now = new Date()): Promise<ArReminderNotification[]> {
  const invoices = await prisma.customerInvoice.findMany({
    where: { tenantId, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
    include: { reminders: true },
  });
  const customers = new Map(
    (
      await prisma.customer.findMany({
        where: { tenantId, id: { in: [...new Set(invoices.map((i) => i.customerId))] } },
        select: { id: true, arOwnerId: true },
      })
    ).map((c) => [c.id, c.arOwnerId]),
  );
  const sent: ArReminderNotification[] = [];
  for (const invoice of invoices) {
    const logged = new Set(invoice.reminders.map((r) => r.offsetDays));
    for (const offset of AR_REMINDER_OFFSETS) {
      if (logged.has(offset)) continue;
      const fireAt = new Date(invoice.dueDate.getTime() + offset * 86400_000);
      if (fireAt > now) continue;
      await prisma.arReminderLog.create({
        data: { tenantId, customerInvoiceId: invoice.id, offsetDays: offset },
      });
      sent.push({
        customerInvoiceId: invoice.id,
        number: invoice.number,
        offsetDays: offset,
        arOwnerId: customers.get(invoice.customerId) ?? null,
      });
    }
  }
  return sent;
}

/** Job: ISSUED/PARTIALLY_PAID с due < now → OVERDUE + Task AR_FOLLOWUP. */
export async function markOverdueCustomerInvoices(tenantId: string, now = new Date()): Promise<number> {
  const overdue = await prisma.customerInvoice.findMany({
    where: { tenantId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] }, dueDate: { lt: now } },
  });
  for (const invoice of overdue) {
    await withAudit({ tenantId }, async (tx) => {
      const after = await tx.customerInvoice.update({ where: { id: invoice.id }, data: { status: 'OVERDUE' } });
      const customer = await tx.customer.findUnique({ where: { id: invoice.customerId } });
      await tx.task.create({
        data: {
          tenantId,
          type: 'AR_FOLLOWUP',
          objectType: 'customer_invoice',
          objectId: invoice.id,
          ownerId: customer?.arOwnerId ?? null,
          dueAt: now,
          nextAction: `Связаться с клиентом по счёту ${invoice.number}: просрочен, зафиксировать promise-to-pay`,
        },
      });
      return {
        result: after,
        audit: {
          action: 'customer_invoice.overdue',
          objectType: 'customer_invoice',
          objectId: invoice.id,
          before: { status: invoice.status },
          after: { status: 'OVERDUE' },
        },
      };
    });
  }
  return overdue.length;
}

// ── Чтение ──

export async function listCustomerInvoices(ctx: TenantContext, filter?: { status?: CustomerInvoiceStatus[] }) {
  requirePermission(ctx, 'payment.view');
  return prisma.customerInvoice.findMany({
    where: whereTenant(ctx, filter?.status ? { status: { in: filter.status } } : {}),
    orderBy: { dueDate: 'asc' },
    take: 200,
  });
}
