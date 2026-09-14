/**
 * B-08: Invoice — создание, дубликаты (BR-002), match (BR-037), corrective (BR-024),
 * backdated (BR-025), баланс (интерфейс v_invoice_balance; paid/pending — Phase C).
 */
import type { TenantContext } from '@finance-os/core';
import {
  NotFoundError,
  ValidationError,
  prMachine,
  requirePermission,
  type PrStatus,
} from '@finance-os/core';
import type { EdoStatus, Invoice, InvoiceStatus, InvoiceType, Prisma } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';

const BACKDATED_DAYS = 30;

export interface InvoiceInput {
  vendorId: string;
  number: string;
  date: Date;
  type?: InvoiceType;
  amountNetMinor: bigint;
  vatMinor?: bigint;
  amountGrossMinor: bigint;
  currency?: string;
  fxRate?: string | null;
  edoDocumentId?: string | null;
  edoStatus?: EdoStatus;
  contractId?: string | null;
  prId?: string | null;
  backdatedReason?: string | null;
  isCorrectiveOfId?: string | null;
}

function assertBackdated(date: Date, reason?: string | null): void {
  const limit = new Date();
  limit.setDate(limit.getDate() - BACKDATED_DAYS);
  if (date < limit && (!reason || reason.trim().length < 5)) {
    throw new ValidationError(
      'BACKDATED_REASON_REQUIRED',
      `Документ старше ${BACKDATED_DAYS} дней требует backdated_reason (BR-025)`,
    );
  }
}

/**
 * BR-002: дубликат по (vendor, number, date) среди не-CANCELLED →
 * создаётся как DUPLICATE_SUSPECT + Task REVIEW_EXCEPTION; платежи по нему блокированы.
 */
export async function createInvoice(ctx: TenantContext, input: InvoiceInput) {
  requirePermission(ctx, 'invoice.create');
  if (!input.number.trim()) throw new ValidationError('NUMBER_REQUIRED');
  if (input.amountGrossMinor <= 0n) throw new ValidationError('AMOUNT_INVALID');
  assertBackdated(input.date, input.backdatedReason);
  const vendor = await prisma.vendor.findFirst({ where: { id: input.vendorId, tenantId: ctx.tenantId } });
  if (!vendor) throw new NotFoundError();

  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const duplicate = await tx.invoice.findFirst({
      where: {
        tenantId: ctx.tenantId,
        vendorId: input.vendorId,
        number: input.number,
        date: input.date,
        status: { notIn: ['CANCELLED'] },
      },
    });
    const isDuplicate = duplicate !== null;
    const created = await tx.invoice.create({
      data: {
        tenantId: ctx.tenantId,
        vendorId: input.vendorId,
        number: input.number,
        date: input.date,
        type: input.type ?? 'INVOICE',
        amountNetMinor: input.amountNetMinor,
        vatMinor: input.vatMinor ?? 0n,
        amountGrossMinor: input.amountGrossMinor,
        currency: input.currency ?? 'UZS',
        fxRate: input.fxRate ?? null,
        edoDocumentId: input.edoDocumentId ?? null,
        edoStatus: input.edoStatus ?? 'NONE',
        contractId: input.contractId ?? null,
        prId: input.prId ?? null,
        backdatedReason: input.backdatedReason ?? null,
        isCorrectiveOfId: input.isCorrectiveOfId ?? null,
        status: isDuplicate ? 'DUPLICATE_SUSPECT' : 'RECEIVED',
        duplicateOfId: duplicate?.id ?? null,
        createdBy: ctx.userId,
      },
    });
    if (isDuplicate) {
      await tx.task.create({
        data: {
          tenantId: ctx.tenantId,
          type: 'REVIEW_EXCEPTION',
          objectType: 'invoice',
          objectId: created.id,
          nextAction: `Проверить дубликат: счёт ${input.number} от ${input.date.toISOString().slice(0, 10)} ${vendor.displayName} уже существует`,
          createdBy: ctx.userId,
        },
      });
    }
    return {
      result: created,
      audit: {
        action: isDuplicate ? 'invoice.duplicate_suspect' : 'invoice.create',
        objectType: 'invoice',
        objectId: created.id,
        after: {
          number: created.number,
          vendorId: created.vendorId,
          amountGrossMinor: created.amountGrossMinor.toString(),
          status: created.status,
          duplicateOfId: created.duplicateOfId,
        },
      },
    };
  });
}

/** BR-002 exception: Lead помечает NOT_DUPLICATE c reason → RECEIVED, либо подтверждает дубликат → CANCELLED. */
export async function resolveDuplicate(
  ctx: TenantContext,
  invoiceId: string,
  resolution: 'NOT_DUPLICATE' | 'CONFIRM_DUPLICATE',
  reason?: string,
) {
  requirePermission(ctx, 'invoice.resolve_duplicate');
  if (resolution === 'NOT_DUPLICATE' && (!reason || reason.trim().length < 5)) {
    throw new ValidationError('REASON_REQUIRED', 'mark_not_duplicate требует reason (BR-002)');
  }
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const invoice = await findScopedOr404(tx.invoice, ctx, invoiceId);
    if (invoice.status !== 'DUPLICATE_SUSPECT') throw new ValidationError('NOT_DUPLICATE_SUSPECT');
    const status: InvoiceStatus = resolution === 'NOT_DUPLICATE' ? 'RECEIVED' : 'CANCELLED';
    const after = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        // duplicate_of сохраняется как ссылка на оригинал — уникальный индекс
        // распространяется только на оригиналы (duplicate_of IS NULL)
        status,
        updatedBy: ctx.userId,
      },
    });
    await tx.task.updateMany({
      where: { tenantId: ctx.tenantId, objectType: 'invoice', objectId: invoiceId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      data: { status: 'DONE' },
    });
    return {
      result: after,
      audit: {
        action: `invoice.${resolution.toLowerCase()}`,
        objectType: 'invoice',
        objectId: invoiceId,
        before: { status: 'DUPLICATE_SUSPECT' },
        after: { status, reason: reason ?? null },
      },
    };
  });
}

/** Match к contract/PR/receipt; ИНН vendor и corrective проверены при создании/импорте. */
export async function matchInvoice(
  ctx: TenantContext,
  invoiceId: string,
  link: { contractId?: string | null; prId?: string | null; receiptId?: string | null },
) {
  requirePermission(ctx, 'invoice.match');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const invoice = await findScopedOr404(tx.invoice, ctx, invoiceId);
    if (!['RECEIVED', 'DISPUTED'].includes(invoice.status)) {
      throw new ValidationError('INVOICE_NOT_MATCHABLE', `Match невозможен в статусе ${invoice.status}`);
    }
    if (link.prId) {
      const pr = await tx.purchaseRequest.findFirst({ where: { id: link.prId, tenantId: ctx.tenantId } });
      if (!pr) throw new NotFoundError();
      if (pr.vendorId && pr.vendorId !== invoice.vendorId) {
        throw new ValidationError('VENDOR_MISMATCH', 'Vendor PR не совпадает с vendor счёта');
      }
    }
    if (link.contractId) {
      const contract = await tx.contract.findFirst({ where: { id: link.contractId, tenantId: ctx.tenantId } });
      if (!contract) throw new NotFoundError();
      if (contract.vendorId !== invoice.vendorId) {
        throw new ValidationError('VENDOR_MISMATCH', 'Vendor договора не совпадает с vendor счёта');
      }
    }
    if (!link.contractId && !link.prId) {
      throw new ValidationError('LINK_REQUIRED', 'Match требует contract или PR');
    }
    const after = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        contractId: link.contractId ?? invoice.contractId,
        prId: link.prId ?? invoice.prId,
        receiptId: link.receiptId ?? invoice.receiptId,
        matchStatus: 'MATCHED',
        status: 'MATCHED',
        updatedBy: ctx.userId,
      },
    });
    // PR → INVOICED
    if (after.prId) {
      const pr = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: after.prId } });
      if (['APPROVED', 'ORDERED', 'RECEIVED'].includes(pr.status)) {
        const to = prMachine.assert(ctx, pr.status as PrStatus, 'link_invoice', {});
        await tx.purchaseRequest.update({ where: { id: pr.id }, data: { status: to } });
      }
    }
    return {
      result: after,
      audit: {
        action: 'invoice.match',
        objectType: 'invoice',
        objectId: invoiceId,
        before: { status: invoice.status, matchStatus: invoice.matchStatus },
        after: { status: 'MATCHED', contractId: after.contractId, prId: after.prId },
      },
    };
  });
}

/** BR-037/споры: dispute c reason (например, ИНН в СФ ≠ ИНН vendor). */
export async function disputeInvoice(ctx: TenantContext, invoiceId: string, reason: string) {
  requirePermission(ctx, 'invoice.match');
  if (!reason.trim()) throw new ValidationError('REASON_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const invoice = await findScopedOr404(tx.invoice, ctx, invoiceId);
    if (!['RECEIVED', 'MATCHED'].includes(invoice.status)) throw new ValidationError('INVOICE_NOT_DISPUTABLE');
    const after = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'DISPUTED', matchStatus: 'DISPUTED', updatedBy: ctx.userId },
    });
    await tx.task.create({
      data: {
        tenantId: ctx.tenantId,
        type: 'REVIEW_EXCEPTION',
        objectType: 'invoice',
        objectId: invoiceId,
        nextAction: `Спорный счёт ${invoice.number}: ${reason}`,
        createdBy: ctx.userId,
      },
    });
    return {
      result: after,
      audit: {
        action: 'invoice.dispute',
        objectType: 'invoice',
        objectId: invoiceId,
        before: { status: invoice.status },
        after: { status: 'DISPUTED', reason },
      },
    };
  });
}

/**
 * BR-024: смена edo-статуса на CORRECTED/CANCELLED. Все связанные не-PAID
 * PaymentRequest → ON_HOLD (реализуется в Phase C), Task REVIEW_EXCEPTION создаётся всегда.
 */
export async function applyEdoStatus(ctx: TenantContext | null, invoiceId: string, edoStatus: EdoStatus) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new NotFoundError();
  const tenantId = invoice.tenantId;
  return withAudit({ tenantId, userId: ctx?.userId }, async (tx) => {
    let status: InvoiceStatus = invoice.status;
    if (edoStatus === 'CORRECTED' && ['MATCHED', 'PAID', 'PARTIALLY_PAID', 'RECEIVED'].includes(invoice.status)) {
      status = 'CORRECTED';
    }
    if (edoStatus === 'CANCELLED') status = 'CANCELLED';
    const after = await tx.invoice.update({
      where: { id: invoiceId },
      data: { edoStatus, status },
    });
    if (edoStatus === 'CORRECTED' || edoStatus === 'CANCELLED') {
      await tx.task.create({
        data: {
          tenantId,
          type: 'REVIEW_EXCEPTION',
          objectType: 'invoice',
          objectId: invoiceId,
          nextAction: `СФ ${invoice.number}: статус ЭДО ${edoStatus} — проверить связанные платежи (BR-024)`,
        },
      });
    }
    return {
      result: after,
      audit: {
        action: 'invoice.edo_status',
        objectType: 'invoice',
        objectId: invoiceId,
        before: { edoStatus: invoice.edoStatus, status: invoice.status },
        after: { edoStatus, status },
      },
    };
  });
}

// ── Suggestions & баланс ──

/** Match suggestions: contract/PR того же vendor, сумма ±5%, недавние (docs/06 §6). */
export async function matchSuggestions(ctx: TenantContext, invoiceId: string) {
  requirePermission(ctx, 'invoice.match');
  const invoice = await findScopedOr404(prisma.invoice, ctx, invoiceId);
  const low = (invoice.amountGrossMinor * 95n) / 100n;
  const high = (invoice.amountGrossMinor * 105n) / 100n;
  const [prs, contracts] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: whereTenant<Prisma.PurchaseRequestWhereInput>(ctx, {
        vendorId: invoice.vendorId,
        totalMinor: { gte: low, lte: high },
        status: { in: ['APPROVED', 'ORDERED', 'RECEIVED'] },
      }),
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.contract.findMany({
      where: whereTenant<Prisma.ContractWhereInput>(ctx, { vendorId: invoice.vendorId, status: 'ACTIVE' }),
      take: 5,
    }),
  ]);
  return {
    prs: prs.map((pr) => ({
      pr,
      confidence: pr.totalMinor === invoice.amountGrossMinor ? 0.9 : 0.7,
    })),
    contracts,
  };
}

export interface InvoiceBalance {
  grossMinor: bigint;
  paidMinor: bigint;
  requestedPendingMinor: bigint;
  outstandingMinor: bigint;
}

/** v_invoice_balance (docs/02 §9): gross / paid / requested_pending / outstanding. */
export async function getInvoiceBalance(ctx: TenantContext, invoiceId: string): Promise<InvoiceBalance> {
  const invoice = await findScopedOr404(prisma.invoice, ctx, invoiceId);
  const [paidAgg, pendingAgg] = await Promise.all([
    prisma.paymentRequest.aggregate({
      where: { tenantId: ctx.tenantId, sourceType: 'INVOICE', sourceId: invoiceId, status: { in: ['PAID', 'RECONCILED', 'CLOSED'] } },
      _sum: { requestedMinor: true },
    }),
    prisma.paymentRequest.aggregate({
      where: {
        tenantId: ctx.tenantId,
        sourceType: 'INVOICE',
        sourceId: invoiceId,
        status: { in: ['SUBMITTED', 'DOCS_CHECK', 'ON_HOLD', 'READY_FOR_BATCH', 'IN_BATCH', 'APPROVED', 'SENT_TO_BANK'] },
      },
      _sum: { requestedMinor: true },
    }),
  ]);
  const paid = paidAgg._sum.requestedMinor ?? 0n;
  const pending = pendingAgg._sum.requestedMinor ?? 0n;
  return {
    grossMinor: invoice.amountGrossMinor,
    paidMinor: paid,
    requestedPendingMinor: pending,
    outstandingMinor: invoice.amountGrossMinor - paid - pending,
  };
}

// ── Импорт реестра ЭДО (docs/07 §2) ──

export interface EdoRegistryRow {
  edoDocumentId: string;
  type: string;
  number: string;
  date: string; // YYYY-MM-DD
  sellerTaxId: string;
  sellerName: string;
  buyerTaxId: string;
  amountNet: string;
  vat: string;
  amountGross: string;
  currency: string;
  status: string;
  correctiveOf?: string;
}

export interface ImportReport {
  total: number;
  imported: number;
  skipped: number;
  errors: { row: number; field: string; message: string }[];
  createdTasks: string[];
}

const EDO_STATUSES = ['DRAFT', 'SENT', 'SIGNED', 'REJECTED', 'CANCELLED', 'CORRECTED'];
const INVOICE_TYPES = ['SF', 'INVOICE', 'ACT', 'WAYBILL'];

/** Импорт Excel-реестра СФ из Didox (mock): построчный отчёт, vendor auto-create PENDING. */
export async function importEdoRegistry(ctx: TenantContext, rows: EdoRegistryRow[]): Promise<ImportReport> {
  requirePermission(ctx, 'invoice.import');
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const report: ImportReport = { total: rows.length, imported: 0, skipped: 0, errors: [], createdTasks: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNum = i + 2; // первая строка — заголовок
    try {
      if (row.buyerTaxId !== tenant.taxId) {
        report.errors.push({ row: rowNum, field: 'buyer_tax_id', message: `ИНН покупателя ${row.buyerTaxId} ≠ ИНН tenant` });
        continue;
      }
      if (!EDO_STATUSES.includes(row.status)) {
        report.errors.push({ row: rowNum, field: 'status', message: `Неизвестный статус ${row.status}` });
        continue;
      }
      const type = INVOICE_TYPES.includes(row.type) ? (row.type as InvoiceType) : 'SF';
      // существующий edo_document_id → skip (идемпотентность)
      const existing = await prisma.invoice.findFirst({
        where: { tenantId: ctx.tenantId, edoDocumentId: row.edoDocumentId },
      });
      if (existing) {
        report.skipped++;
        continue;
      }
      let vendor = await prisma.vendor.findFirst({
        where: { tenantId: ctx.tenantId, taxId: row.sellerTaxId, status: { not: 'BLOCKED' } },
      });
      if (!vendor) {
        vendor = await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
          const created = await tx.vendor.create({
            data: {
              tenantId: ctx.tenantId,
              taxId: row.sellerTaxId,
              legalName: row.sellerName,
              displayName: row.sellerName,
              status: 'PENDING_VERIFICATION',
              riskFlags: ['NEW'],
              createdBy: ctx.userId,
            },
          });
          const task = await tx.task.create({
            data: {
              tenantId: ctx.tenantId,
              type: 'VERIFY_BANK',
              objectType: 'vendor',
              objectId: created.id,
              nextAction: `Новый vendor из реестра ЭДО: ${row.sellerName} (ИНН ${row.sellerTaxId}) — заполнить реквизиты и верифицировать`,
              createdBy: ctx.userId,
            },
          });
          report.createdTasks.push(task.id);
          return {
            result: created,
            audit: {
              action: 'vendor.create_from_edo',
              objectType: 'vendor',
              objectId: created.id,
              after: { taxId: row.sellerTaxId, legalName: row.sellerName },
            },
          };
        });
      }
      const corrective = row.correctiveOf
        ? await prisma.invoice.findFirst({
            where: { tenantId: ctx.tenantId, edoDocumentId: row.correctiveOf },
          })
        : null;
      const invoice = await createInvoice(ctx, {
        vendorId: vendor.id,
        number: row.number,
        date: new Date(row.date),
        type,
        amountNetMinor: BigInt(Math.round(Number(row.amountNet) * 100)),
        vatMinor: BigInt(Math.round(Number(row.vat || '0') * 100)),
        amountGrossMinor: BigInt(Math.round(Number(row.amountGross) * 100)),
        currency: row.currency || 'UZS',
        edoDocumentId: row.edoDocumentId,
        edoStatus: row.status as EdoStatus,
        isCorrectiveOfId: corrective?.id ?? null,
        backdatedReason: 'Импорт реестра ЭДО',
      });
      // BR-024: corrective → задача по оригиналу
      if (corrective) {
        await applyEdoStatus(ctx, corrective.id, 'CORRECTED');
      }
      // ИНН mismatch между vendor и строкой реестра невозможен здесь (vendor найден по tax_id),
      // но mismatch с существующим счётом того же номера ловится duplicate-веткой.
      void invoice;
      report.imported++;
    } catch (e) {
      report.errors.push({ row: rowNum, field: '', message: e instanceof Error ? e.message : String(e) });
    }
  }
  // E-02: регистрируем документы в mock-панели ЭДО (динамический импорт против цикла)
  const { syncEdoMockDocuments } = await import('./edo.js');
  await syncEdoMockDocuments(
    ctx.tenantId,
    rows
      .filter((row) => EDO_STATUSES.includes(row.status))
      .map((row) => ({ edoDocumentId: row.edoDocumentId, status: row.status as EdoStatus })),
  );
  return report;
}

// ── Чтение ──

export async function listInvoices(ctx: TenantContext, filter?: { status?: InvoiceStatus[] }) {
  requirePermission(ctx, 'invoice.create');
  return prisma.invoice.findMany({
    where: whereTenant(ctx, filter?.status ? { status: { in: filter.status } } : {}),
    orderBy: { date: 'desc' },
    take: 200,
  });
}

export async function getInvoiceWithVendor(ctx: TenantContext, id: string): Promise<Invoice & { vendorName: string }> {
  const invoice = await findScopedOr404(prisma.invoice, ctx, id);
  const vendor = await prisma.vendor.findUnique({ where: { id: invoice.vendorId } });
  return { ...invoice, vendorName: vendor?.displayName ?? '' };
}

export type { Prisma };
