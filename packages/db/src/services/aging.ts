/**
 * D-01: AP aging (v_ap_aging, docs/02 §9) + vendor statement reconciliation.
 * Buckets: NOT_DUE / 1-7 / 8-30 / 31-60 / 60+ дней просрочки.
 * Due date счёта = invoice.date + POSTPAY_DAYS из договора (или 0 дней).
 */
import type { TenantContext } from '@finance-os/core';
import { requirePermission } from '@finance-os/core';
import { prisma } from '../client.js';
import { whereTenant } from '../repository.js';

export const AP_BUCKETS = ['NOT_DUE', 'D1_7', 'D8_30', 'D31_60', 'D60_PLUS'] as const;
export type ApBucket = (typeof AP_BUCKETS)[number];

// статусы счетов, образующие кредиторку
const AP_INVOICE_STATUSES = ['RECEIVED', 'MATCHED', 'DISPUTED', 'PARTIALLY_PAID', 'CORRECTED'] as const;
const PAID_STATUSES = ['PAID', 'RECONCILED', 'CLOSED'] as const;

export interface ApAgingInvoice {
  invoiceId: string;
  number: string;
  date: Date;
  dueDate: Date;
  bucket: ApBucket;
  outstandingMinor: bigint;
  disputed: boolean;
}

export interface ApAgingRow {
  vendorId: string;
  vendorName: string;
  buckets: Record<ApBucket, bigint>;
  totalMinor: bigint;
  invoices: ApAgingInvoice[];
}

export function bucketOf(dueDate: Date, now: Date): ApBucket {
  const overdueDays = Math.floor((now.getTime() - dueDate.getTime()) / 86400_000);
  if (overdueDays <= 0) return 'NOT_DUE';
  if (overdueDays <= 7) return 'D1_7';
  if (overdueDays <= 30) return 'D8_30';
  if (overdueDays <= 60) return 'D31_60';
  return 'D60_PLUS';
}

export async function getApAging(ctx: TenantContext, now = new Date()): Promise<ApAgingRow[]> {
  requirePermission(ctx, 'payment.view');
  const invoices = await prisma.invoice.findMany({
    where: whereTenant(ctx, { status: { in: [...AP_INVOICE_STATUSES] } }),
    orderBy: { date: 'asc' },
  });
  if (invoices.length === 0) return [];
  const [vendors, contracts, paidAgg] = await Promise.all([
    prisma.vendor.findMany({
      where: { tenantId: ctx.tenantId, id: { in: [...new Set(invoices.map((i) => i.vendorId))] } },
      select: { id: true, displayName: true },
    }),
    prisma.contract.findMany({
      where: { tenantId: ctx.tenantId, id: { in: [...new Set(invoices.map((i) => i.contractId).filter((c): c is string => !!c))] } },
      select: { id: true, paymentTerms: true },
    }),
    prisma.paymentRequest.groupBy({
      by: ['sourceId'],
      where: {
        tenantId: ctx.tenantId,
        sourceType: 'INVOICE',
        sourceId: { in: invoices.map((i) => i.id) },
        status: { in: [...PAID_STATUSES] },
      },
      _sum: { requestedMinor: true },
    }),
  ]);
  const vendorName = new Map(vendors.map((v) => [v.id, v.displayName]));
  const termsDays = new Map(
    contracts.map((c) => {
      const terms = c.paymentTerms as { type?: string; value?: number } | null;
      return [c.id, terms?.type === 'POSTPAY_DAYS' ? (terms.value ?? 0) : 0];
    }),
  );
  const paidBy = new Map(paidAgg.map((p) => [p.sourceId, p._sum.requestedMinor ?? 0n]));

  const rows = new Map<string, ApAgingRow>();
  for (const invoice of invoices) {
    const outstanding = invoice.amountGrossMinor - (paidBy.get(invoice.id) ?? 0n);
    if (outstanding <= 0n) continue;
    const days = invoice.contractId ? (termsDays.get(invoice.contractId) ?? 0) : 0;
    const dueDate = new Date(invoice.date.getTime() + days * 86400_000);
    const bucket = bucketOf(dueDate, now);
    let row = rows.get(invoice.vendorId);
    if (!row) {
      row = {
        vendorId: invoice.vendorId,
        vendorName: vendorName.get(invoice.vendorId) ?? '—',
        buckets: { NOT_DUE: 0n, D1_7: 0n, D8_30: 0n, D31_60: 0n, D60_PLUS: 0n },
        totalMinor: 0n,
        invoices: [],
      };
      rows.set(invoice.vendorId, row);
    }
    row.buckets[bucket] += outstanding;
    row.totalMinor += outstanding;
    row.invoices.push({
      invoiceId: invoice.id,
      number: invoice.number,
      date: invoice.date,
      dueDate,
      bucket,
      outstandingMinor: outstanding,
      disputed: invoice.status === 'DISPUTED',
    });
  }
  return [...rows.values()].sort((a, b) => (a.totalMinor > b.totalMinor ? -1 : 1));
}

// ── Vendor statement reconciliation (акт сверки) ──

export interface StatementRow {
  number: string;
  amountMinor: bigint;
  date?: string;
}

export interface StatementDiff {
  matched: { number: string; amountMinor: bigint }[];
  amountMismatch: { number: string; statementMinor: bigint; systemMinor: bigint }[];
  missingInSystem: StatementRow[]; // есть у поставщика, нет у нас
  missingInStatement: { number: string; amountMinor: bigint }[]; // есть у нас, нет у поставщика
}

/** CSV акта сверки: `number;date;amount` (amount в сумах, header опционален). */
export function parseStatementCsv(content: string): StatementRow[] {
  const rows: StatementRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^number|^номер/i.test(trimmed)) continue;
    const [number = '', date = '', amount = ''] = trimmed.split(';').map((c) => c.trim());
    if (!number || !amount) continue;
    const normalized = amount.replace(/[\s\u00a0]/g, '').replace(',', '.');
    const [int = '0', frac = ''] = normalized.split('.');
    rows.push({ number, amountMinor: BigInt(int || '0') * 100n + BigInt(frac.slice(0, 2).padEnd(2, '0') || '0'), date });
  }
  return rows;
}

/** Сравнение акта сверки поставщика с системой: по номерам счетов (кроме CANCELLED). */
export async function reconcileVendorStatement(
  ctx: TenantContext,
  vendorId: string,
  statement: StatementRow[],
): Promise<StatementDiff> {
  requirePermission(ctx, 'payment.view');
  const invoices = await prisma.invoice.findMany({
    where: whereTenant(ctx, { vendorId, status: { not: 'CANCELLED' as const } }),
  });
  const system = new Map(invoices.map((i) => [i.number, i.amountGrossMinor]));
  const seen = new Set<string>();
  const diff: StatementDiff = { matched: [], amountMismatch: [], missingInSystem: [], missingInStatement: [] };
  for (const row of statement) {
    const systemAmount = system.get(row.number);
    if (systemAmount === undefined) {
      diff.missingInSystem.push(row);
      continue;
    }
    seen.add(row.number);
    if (systemAmount === row.amountMinor) diff.matched.push({ number: row.number, amountMinor: row.amountMinor });
    else diff.amountMismatch.push({ number: row.number, statementMinor: row.amountMinor, systemMinor: systemAmount });
  }
  for (const [number, amountMinor] of system) {
    if (!seen.has(number)) diff.missingInStatement.push({ number, amountMinor });
  }
  return diff;
}
