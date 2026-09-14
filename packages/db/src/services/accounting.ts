/**
 * E-04: AccountingAdapter / 1С (docs/07 §4).
 * AccountMapping (category → счёт 1С) правится админом; exportPostings — CSV
 * оплаченных платежей периода; importPostedStatus — RECONCILED → CLOSED + onec_ref.
 */
import type { TenantContext } from '@finance-os/core';
import { ValidationError, requirePermission } from '@finance-os/core';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { whereTenant } from '../repository.js';

// ── AccountMapping ──

export async function upsertAccountMapping(
  ctx: TenantContext,
  input: { categoryId: string; accountCode: string; vatAccountCode?: string | null },
) {
  requirePermission(ctx, 'tenant.settings');
  if (!input.accountCode.trim()) throw new ValidationError('ACCOUNT_CODE_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const category = await tx.category.findFirst({ where: { id: input.categoryId, tenantId: ctx.tenantId } });
    if (!category) throw new ValidationError('CATEGORY_NOT_FOUND');
    const mapping = await tx.accountMapping.upsert({
      where: { tenantId_categoryId: { tenantId: ctx.tenantId, categoryId: input.categoryId } },
      create: {
        tenantId: ctx.tenantId,
        categoryId: input.categoryId,
        accountCode: input.accountCode,
        vatAccountCode: input.vatAccountCode ?? null,
      },
      update: { accountCode: input.accountCode, vatAccountCode: input.vatAccountCode ?? null },
    });
    return {
      result: mapping,
      audit: {
        action: 'account_mapping.upsert',
        objectType: 'category',
        objectId: input.categoryId,
        after: { accountCode: input.accountCode, vatAccountCode: input.vatAccountCode ?? null },
      },
    };
  });
}

export async function listAccountMappings(ctx: TenantContext) {
  requirePermission(ctx, 'payment.view');
  return prisma.accountMapping.findMany({ where: whereTenant(ctx) });
}

// ── Export postings (docs/07 §4) ──

const EXPORT_HEADER =
  'payment_request_number;paid_at;vendor_tax_id;vendor_name;amount;vat;currency;account_code;vat_account_code;cost_center;category;purpose;invoice_number;invoice_date;contract_number';

export async function exportPostingsCsv(ctx: TenantContext, period: string): Promise<Buffer> {
  requirePermission(ctx, 'report.export');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ValidationError('PERIOD_INVALID', 'Период — YYYY-MM');
  const [y, m] = period.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const payments = await prisma.paymentRequest.findMany({
    where: whereTenant(ctx, {
      status: { in: ['PAID' as const, 'RECONCILED' as const, 'CLOSED' as const] },
      paidAt: { gte: from, lt: to },
    }),
    orderBy: { number: 'asc' },
  });
  const [vendors, mappings, categories, ccs, contracts] = await Promise.all([
    prisma.vendor.findMany({ where: { tenantId: ctx.tenantId } }),
    prisma.accountMapping.findMany({ where: { tenantId: ctx.tenantId } }),
    prisma.category.findMany({ where: { tenantId: ctx.tenantId } }),
    prisma.costCenter.findMany({ where: { tenantId: ctx.tenantId } }),
    prisma.contract.findMany({ where: { tenantId: ctx.tenantId } }),
  ]);
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const mappingByCat = new Map(mappings.map((mp) => [mp.categoryId, mp]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const ccById = new Map(ccs.map((c) => [c.id, c.code]));
  const contractById = new Map(contracts.map((c) => [c.id, c.number]));
  const invoiceIds = payments.filter((p) => p.sourceType === 'INVOICE').map((p) => p.sourceId);
  const invoices = new Map(
    (await prisma.invoice.findMany({ where: { id: { in: invoiceIds } } })).map((inv) => [inv.id, inv]),
  );

  const soum = (minor: bigint) => `${minor / 100n}.${String(minor % 100n < 0n ? -(minor % 100n) : minor % 100n).padStart(2, '0')}`;
  const lines = [EXPORT_HEADER];
  for (const payment of payments) {
    const vendor = payment.vendorId ? vendorById.get(payment.vendorId) : null;
    const mapping = payment.categoryId ? mappingByCat.get(payment.categoryId) : null;
    const invoice = payment.sourceType === 'INVOICE' ? invoices.get(payment.sourceId) : null;
    const contractNumber =
      payment.sourceType === 'CONTRACT'
        ? (contractById.get(payment.sourceId) ?? '')
        : invoice?.contractId
          ? (contractById.get(invoice.contractId) ?? '')
          : '';
    lines.push(
      [
        payment.number,
        payment.paidAt?.toISOString().slice(0, 10) ?? '',
        vendor?.taxId ?? '',
        vendor?.legalName ?? '',
        soum(payment.requestedMinor),
        invoice ? soum(invoice.vatMinor) : '0.00',
        payment.currency,
        mapping?.accountCode ?? '',
        mapping?.vatAccountCode ?? '',
        payment.costCenterId ? (ccById.get(payment.costCenterId) ?? '') : '',
        payment.categoryId ? (catById.get(payment.categoryId)?.name ?? '') : '',
        payment.purposeNote.replaceAll(';', ','),
        invoice?.number ?? '',
        invoice?.date.toISOString().slice(0, 10) ?? '',
        contractNumber,
      ].join(';'),
    );
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

// ── Import posted (1С подтверждает проводки) ──

export interface PostedRow {
  paymentRequestNumber: string;
  postedAt: string;
  onecDocumentRef: string;
}

export function parsePostedCsv(content: string): PostedRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const rows: PostedRow[] = [];
  for (const line of lines) {
    if (/^payment_request_number/i.test(line)) continue;
    const [paymentRequestNumber = '', postedAt = '', onecDocumentRef = ''] = line.split(';').map((c) => c.trim());
    if (paymentRequestNumber) rows.push({ paymentRequestNumber, postedAt, onecDocumentRef });
  }
  return rows;
}

export interface PostedReport {
  total: number;
  closed: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

/** RECONCILED → CLOSED c onec_ref; PAID тоже принимается (сверка догоняет). */
export async function importPostedStatus(ctx: TenantContext, rows: PostedRow[]): Promise<PostedReport> {
  requirePermission(ctx, 'report.export');
  const report: PostedReport = { total: rows.length, closed: 0, skipped: 0, errors: [] };
  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const payment = await tx.paymentRequest.findFirst({
        where: { tenantId: ctx.tenantId, number: row.paymentRequestNumber },
      });
      if (!payment) {
        report.errors.push({ row: i + 1, message: `Платёж ${row.paymentRequestNumber} не найден` });
        continue;
      }
      if (payment.status === 'CLOSED') {
        report.skipped++;
        continue;
      }
      if (!['PAID', 'RECONCILED'].includes(payment.status)) {
        report.errors.push({ row: i + 1, message: `${row.paymentRequestNumber}: статус ${payment.status}, проводка невозможна` });
        continue;
      }
      await tx.paymentRequest.update({
        where: { id: payment.id },
        data: { status: 'CLOSED', onecRef: row.onecDocumentRef || null, updatedBy: ctx.userId },
      });
      report.closed++;
    }
    return {
      result: report,
      audit: {
        action: 'accounting.import_posted',
        objectType: 'tenant',
        objectId: ctx.tenantId,
        after: { closed: report.closed, skipped: report.skipped, errors: report.errors.length },
      },
    };
  });
  return report;
}
