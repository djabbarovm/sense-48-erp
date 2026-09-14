/**
 * E-05: импортёры Excel-миграции (templates/README.md).
 * All-or-nothing на файл: сначала валидация всех строк (отчёт row+field),
 * запись — одной транзакцией только если ошибок нет. Повтор по бизнес-ключу → skipped.
 * Исторические оплаты open_ap проводятся служебными платежами CLOSED через
 * архивный счёт «Миграция» (is_active=false → не влияет на cash), чтобы
 * BR-054 и балансы оставались честными (ADR-008).
 */
import type { TenantContext } from '@finance-os/core';
import { encryptSecret, maskAccount, parseDecimalToMinor, requirePermission } from '@finance-os/core';
import type { Prisma } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';

type Tx = Prisma.TransactionClient;
type Row = Record<string, string>;

export interface MigrationReport {
  total: number;
  imported: number;
  skipped: number;
  errors: { row: number; field: string; message: string }[];
}

class RowErrors {
  readonly errors: MigrationReport['errors'] = [];
  add(row: number, field: string, message: string) {
    this.errors.push({ row: row + 2, field, message }); // +2: заголовок + 1-индексация
  }
}

const yn = (value: string) => /^(y|yes|да|1|true)$/i.test(value.trim());

function parseDateStr(value: string): Date | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(value);
  const dot = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dot) return new Date(`${dot[3]}-${dot[2]!.padStart(2, '0')}-${dot[1]!.padStart(2, '0')}`);
  return null;
}

function parseMoney(value: string): bigint | null {
  try {
    return parseDecimalToMinor(value.replace(/[\s\u00a0]/g, ''));
  } catch {
    return null;
  }
}

function bankDataKey(): string {
  return process.env.BANK_DATA_KEY ?? '';
}

// ── vendors.xlsx ──

export async function importVendorsXlsx(ctx: TenantContext, rows: Row[]): Promise<MigrationReport> {
  requirePermission(ctx, 'vendor.create');
  const report: MigrationReport = { total: rows.length, imported: 0, skipped: 0, errors: [] };
  const errors = new RowErrors();
  const categories = new Map(
    (await prisma.category.findMany({ where: { tenantId: ctx.tenantId } })).map((c) => [c.code, c.id]),
  );
  const tenantUsers = new Map(
    (
      await prisma.userTenantRole.findMany({
        where: { tenantId: ctx.tenantId },
        include: { user: { select: { email: true } } },
      })
    ).map((r) => [r.user.email, r.userId]),
  );
  const existingTax = new Set(
    (await prisma.vendor.findMany({ where: { tenantId: ctx.tenantId }, select: { taxId: true } })).map((v) => v.taxId),
  );
  const seenTax = new Set<string>();

  const valid: { row: Row; skip: boolean }[] = [];
  rows.forEach((row, i) => {
    const tax = row.tax_id ?? '';
    if (!/^\d{9}$/.test(tax)) errors.add(i, 'tax_id', 'ИНН — 9 цифр');
    else if (seenTax.has(tax)) errors.add(i, 'tax_id', 'Дубликат ИНН в файле');
    seenTax.add(tax);
    if (!row.legal_name) errors.add(i, 'legal_name', 'Обязательное поле');
    if (!categories.has(row.category_code ?? '')) errors.add(i, 'category_code', `Категория «${row.category_code}» не найдена`);
    if (!/^\d{20}$/.test(row.account ?? '')) errors.add(i, 'account', 'Счёт — 20 цифр');
    if (!row.mfo) errors.add(i, 'mfo', 'Обязательное поле');
    if (!row.bank_name) errors.add(i, 'bank_name', 'Обязательное поле');
    if (!tenantUsers.has(row.business_owner_email ?? '')) {
      errors.add(i, 'business_owner_email', `Пользователь «${row.business_owner_email}» не найден в компании`);
    }
    valid.push({ row, skip: existingTax.has(tax) });
  });
  report.errors = errors.errors;
  if (report.errors.length > 0) return report; // all-or-nothing

  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    for (const { row, skip } of valid) {
      if (skip) {
        report.skipped++;
        continue;
      }
      const vendor = await tx.vendor.create({
        data: {
          tenantId: ctx.tenantId,
          taxId: row.tax_id!,
          legalName: row.legal_name!,
          displayName: row.display_name || row.legal_name!,
          categoryDefaultId: categories.get(row.category_code!)!,
          vatPayer: yn(row.vat_payer ?? ''),
          status: 'ACTIVE',
          riskFlags: yn(row.related_party ?? '') ? ['RELATED_PARTY'] : [],
          businessOwnerId: tenantUsers.get(row.business_owner_email!)!,
          contactName: row.contact_name || null,
          contactPhone: row.contact_phone || null,
          contactEmail: row.contact_email || null,
          requiresContract: yn(row.requires_contract ?? ''),
          createdBy: ctx.userId,
        },
      });
      // исторические реквизиты считаются проверенными (метод DOCUMENT — файл миграции)
      await tx.vendorBankAccount.create({
        data: {
          tenantId: ctx.tenantId,
          vendorId: vendor.id,
          bankName: row.bank_name!,
          mfo: row.mfo!,
          accountMasked: maskAccount(row.account!),
          accountEncrypted: encryptSecret(row.account!, bankDataKey()),
          currency: row.currency || 'UZS',
          status: 'VERIFIED',
          isDefault: true,
          verifiedAt: new Date(),
          verifiedBy: ctx.userId,
          verificationMethod: 'DOCUMENT',
        },
      });
      report.imported++;
    }
    return {
      result: report,
      audit: {
        action: 'migration.vendors',
        objectType: 'tenant',
        objectId: ctx.tenantId,
        after: { imported: report.imported, skipped: report.skipped },
      },
    };
  });
  return report;
}

// ── contracts.xlsx ──

export async function importContractsXlsx(ctx: TenantContext, rows: Row[]): Promise<MigrationReport> {
  requirePermission(ctx, 'contract.create');
  const report: MigrationReport = { total: rows.length, imported: 0, skipped: 0, errors: [] };
  const errors = new RowErrors();
  const vendors = new Map(
    (await prisma.vendor.findMany({ where: { tenantId: ctx.tenantId } })).map((v) => [v.taxId, v.id]),
  );
  const tenantUsers = new Map(
    (
      await prisma.userTenantRole.findMany({ where: { tenantId: ctx.tenantId }, include: { user: { select: { email: true } } } })
    ).map((r) => [r.user.email, r.userId]),
  );
  const existing = new Set(
    (await prisma.contract.findMany({ where: { tenantId: ctx.tenantId }, select: { number: true } })).map((c) => c.number),
  );

  rows.forEach((row, i) => {
    if (!row.number) errors.add(i, 'number', 'Обязательное поле');
    if (!vendors.has(row.vendor_tax_id ?? '')) errors.add(i, 'vendor_tax_id', `Vendor c ИНН «${row.vendor_tax_id}» не найден — сначала импортируйте vendors.xlsx`);
    if (!row.subject) errors.add(i, 'subject', 'Обязательное поле');
    if (!parseDateStr(row.start_date ?? '')) errors.add(i, 'start_date', 'Дата — YYYY-MM-DD или DD.MM.YYYY');
    if (row.end_date && !parseDateStr(row.end_date)) errors.add(i, 'end_date', 'Неверная дата');
    if (!['PREPAY_PCT', 'POSTPAY_DAYS', 'SCHEDULE'].includes(row.payment_terms_type ?? '')) {
      errors.add(i, 'payment_terms_type', 'PREPAY_PCT / POSTPAY_DAYS / SCHEDULE');
    }
    if (!/^\d+$/.test(row.payment_terms_value ?? '')) errors.add(i, 'payment_terms_value', 'Целое число');
    if (row.limit && parseMoney(row.limit) === null) errors.add(i, 'limit', 'Сумма в сумах');
    if (!tenantUsers.has(row.owner_email ?? '')) errors.add(i, 'owner_email', `Пользователь «${row.owner_email}» не найден`);
    if (!['ACTIVE', 'SIGNED', 'EXPIRED'].includes(row.status ?? '')) errors.add(i, 'status', 'ACTIVE / SIGNED / EXPIRED');
  });
  report.errors = errors.errors;
  if (report.errors.length > 0) return report;

  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    for (const row of rows) {
      if (existing.has(row.number!)) {
        report.skipped++;
        continue;
      }
      await tx.contract.create({
        data: {
          tenantId: ctx.tenantId,
          number: row.number!,
          counterpartyType: 'VENDOR',
          vendorId: vendors.get(row.vendor_tax_id!)!,
          subject: row.subject!,
          currency: row.currency || 'UZS',
          limitMinor: row.limit ? parseMoney(row.limit) : null,
          startDate: parseDateStr(row.start_date!)!,
          endDate: row.end_date ? parseDateStr(row.end_date) : null,
          autoRenew: yn(row.auto_renew ?? ''),
          registrationRequired: yn(row.registration_required ?? ''),
          paymentTerms: { type: row.payment_terms_type!, value: Number(row.payment_terms_value) },
          status: row.status as never,
          createdBy: ctx.userId,
        },
      });
      report.imported++;
    }
    return {
      result: report,
      audit: { action: 'migration.contracts', objectType: 'tenant', objectId: ctx.tenantId, after: { imported: report.imported, skipped: report.skipped } },
    };
  });
  return report;
}

// ── open_ap.xlsx ──

/** Архивный счёт для исторических оплат: is_active=false → вне cash position. */
async function migrationBankAccount(tx: Tx, tenantId: string): Promise<string> {
  const existing = await tx.bankAccount.findFirst({ where: { tenantId, accountMasked: '****MIGR' } });
  if (existing) return existing.id;
  const created = await tx.bankAccount.create({
    data: {
      tenantId,
      bankName: 'Миграция (архив)',
      mfo: '00000',
      accountMasked: '****MIGR',
      accountEncrypted: 'MIGRATION',
      isActive: false,
    },
  });
  return created.id;
}

export async function importOpenApXlsx(ctx: TenantContext, rows: Row[]): Promise<MigrationReport> {
  requirePermission(ctx, 'invoice.create');
  const report: MigrationReport = { total: rows.length, imported: 0, skipped: 0, errors: [] };
  const errors = new RowErrors();
  const vendors = new Map((await prisma.vendor.findMany({ where: { tenantId: ctx.tenantId } })).map((v) => [v.taxId, v.id]));
  const contracts = new Map((await prisma.contract.findMany({ where: { tenantId: ctx.tenantId } })).map((c) => [c.number, c.id]));
  const ccs = new Map((await prisma.costCenter.findMany({ where: { tenantId: ctx.tenantId } })).map((c) => [c.code, c.id]));
  const cats = new Map((await prisma.category.findMany({ where: { tenantId: ctx.tenantId } })).map((c) => [c.code, c.id]));
  const existingInvoices = new Set(
    (await prisma.invoice.findMany({ where: { tenantId: ctx.tenantId }, select: { vendorId: true, number: true } })).map(
      (inv) => `${inv.vendorId}:${inv.number}`,
    ),
  );

  rows.forEach((row, i) => {
    if (!vendors.has(row.vendor_tax_id ?? '')) errors.add(i, 'vendor_tax_id', `Vendor «${row.vendor_tax_id}» не найден`);
    if (!row.invoice_number) errors.add(i, 'invoice_number', 'Обязательное поле');
    if (!parseDateStr(row.invoice_date ?? '')) errors.add(i, 'invoice_date', 'Неверная дата');
    if (!['SF', 'INVOICE', 'ACT'].includes(row.invoice_type ?? '')) errors.add(i, 'invoice_type', 'SF / INVOICE / ACT');
    const gross = parseMoney(row.amount_gross ?? '');
    if (gross === null || gross <= 0n) errors.add(i, 'amount_gross', 'Сумма в сумах > 0');
    if (row.paid_to_date) {
      const paid = parseMoney(row.paid_to_date);
      if (paid === null || paid < 0n) errors.add(i, 'paid_to_date', 'Сумма в сумах ≥ 0');
      else if (gross !== null && paid > gross) errors.add(i, 'paid_to_date', 'Оплачено больше суммы счёта');
    }
    if (row.contract_number && !contracts.has(row.contract_number)) errors.add(i, 'contract_number', `Договор «${row.contract_number}» не найден`);
    if (row.cost_center_code && !ccs.has(row.cost_center_code)) errors.add(i, 'cost_center_code', 'Cost center не найден');
    if (row.category_code && !cats.has(row.category_code)) errors.add(i, 'category_code', 'Категория не найдена');
  });
  report.errors = errors.errors;
  if (report.errors.length > 0) return report;

  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    let migrationAccountId: string | null = null;
    let mig = 0;
    for (const row of rows) {
      const vendorId = vendors.get(row.vendor_tax_id!)!;
      if (existingInvoices.has(`${vendorId}:${row.invoice_number}`)) {
        report.skipped++;
        continue;
      }
      const gross = parseMoney(row.amount_gross!)!;
      const vat = row.vat ? (parseMoney(row.vat) ?? 0n) : 0n;
      const paid = row.paid_to_date ? (parseMoney(row.paid_to_date) ?? 0n) : 0n;
      const contractId = row.contract_number ? (contracts.get(row.contract_number) ?? null) : null;
      const invoice = await tx.invoice.create({
        data: {
          tenantId: ctx.tenantId,
          vendorId,
          number: row.invoice_number!,
          date: parseDateStr(row.invoice_date!)!,
          type: row.invoice_type as never,
          amountGrossMinor: gross,
          vatMinor: vat,
          amountNetMinor: gross - vat,
          currency: row.currency || 'UZS',
          contractId,
          edoDocumentId: row.edo_document_id || null,
          matchStatus: contractId ? 'MATCHED' : 'UNMATCHED',
          status: paid >= gross ? 'PAID' : paid > 0n ? 'PARTIALLY_PAID' : contractId ? 'MATCHED' : 'RECEIVED',
          createdBy: ctx.userId,
        },
      });
      // историческая оплата → служебный платёж CLOSED через архивный счёт (ADR-008)
      if (paid > 0n) {
        migrationAccountId ??= await migrationBankAccount(tx, ctx.tenantId);
        mig++;
        const bankTx = await tx.bankTransaction.create({
          data: {
            tenantId: ctx.tenantId,
            bankAccountId: migrationAccountId,
            externalId: `MIGR-${vendorId.slice(0, 8)}-${row.invoice_number}`,
            bookingDate: parseDateStr(row.invoice_date!)!,
            valueDate: parseDateStr(row.invoice_date!)!,
            amountMinor: -paid,
            counterpartyName: row.vendor_tax_id!,
            purposeText: `Миграция: оплачено до внедрения по счёту ${row.invoice_number}`,
            matchStatus: 'MANUAL_MATCHED',
          },
        });
        await tx.paymentRequest.create({
          data: {
            tenantId: ctx.tenantId,
            number: `PAY-MIGR-${String(mig).padStart(4, '0')}-${Date.now() % 100000}`,
            sourceType: 'INVOICE',
            sourceId: invoice.id,
            vendorId,
            requestedMinor: paid,
            purposeNote: `Историческая оплата (миграция) счёта ${row.invoice_number}`,
            costCenterId: row.cost_center_code ? (ccs.get(row.cost_center_code) ?? null) : null,
            categoryId: row.category_code ? (cats.get(row.category_code) ?? null) : null,
            status: 'CLOSED',
            bankTransactionId: bankTx.id,
            paidAt: parseDateStr(row.invoice_date!)!,
            createdBy: ctx.userId,
          },
        });
      }
      report.imported++;
    }
    return {
      result: report,
      audit: { action: 'migration.open_ap', objectType: 'tenant', objectId: ctx.tenantId, after: { imported: report.imported, skipped: report.skipped } },
    };
  });
  return report;
}

// ── open_ar.xlsx ──

export async function importOpenArXlsx(ctx: TenantContext, rows: Row[]): Promise<MigrationReport> {
  requirePermission(ctx, 'ar.invoice.manage');
  const report: MigrationReport = { total: rows.length, imported: 0, skipped: 0, errors: [] };
  const errors = new RowErrors();
  const events = new Map((await prisma.event.findMany({ where: { tenantId: ctx.tenantId } })).map((e) => [e.number, e.id]));
  const existing = new Set(
    (await prisma.customerInvoice.findMany({ where: { tenantId: ctx.tenantId }, select: { number: true } })).map((c) => c.number),
  );

  rows.forEach((row, i) => {
    if (!row.customer_name) errors.add(i, 'customer_name', 'Обязательное поле');
    if (!row.invoice_number) errors.add(i, 'invoice_number', 'Обязательное поле');
    if (!parseDateStr(row.invoice_date ?? '')) errors.add(i, 'invoice_date', 'Неверная дата');
    if (!parseDateStr(row.due_date ?? '')) errors.add(i, 'due_date', 'Неверная дата');
    const gross = parseMoney(row.amount_gross ?? '');
    if (gross === null || gross <= 0n) errors.add(i, 'amount_gross', 'Сумма в сумах > 0');
    if (row.received_to_date) {
      const received = parseMoney(row.received_to_date);
      if (received === null || (gross !== null && received > gross)) errors.add(i, 'received_to_date', 'Получено больше суммы счёта');
    }
    if (row.event_number && !events.has(row.event_number)) errors.add(i, 'event_number', `Событие «${row.event_number}» не найдено`);
  });
  report.errors = errors.errors;
  if (report.errors.length > 0) return report;

  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    for (const row of rows) {
      if (existing.has(row.invoice_number!)) {
        report.skipped++;
        continue;
      }
      // клиент по ИНН или имени; создаём при отсутствии
      let customer = await tx.customer.findFirst({
        where: {
          tenantId: ctx.tenantId,
          OR: [...(row.customer_tax_id ? [{ taxId: row.customer_tax_id }] : []), { legalName: row.customer_name! }],
        },
      });
      customer ??= await tx.customer.create({
        data: { tenantId: ctx.tenantId, taxId: row.customer_tax_id || null, legalName: row.customer_name!, createdBy: ctx.userId },
      });
      const gross = parseMoney(row.amount_gross!)!;
      const received = row.received_to_date ? (parseMoney(row.received_to_date) ?? 0n) : 0n;
      const due = parseDateStr(row.due_date!)!;
      await tx.customerInvoice.create({
        data: {
          tenantId: ctx.tenantId,
          number: row.invoice_number!,
          customerId: customer.id,
          date: parseDateStr(row.invoice_date!)!,
          dueDate: due,
          amountGrossMinor: gross,
          vatMinor: row.vat ? (parseMoney(row.vat) ?? 0n) : 0n,
          currency: row.currency || 'UZS',
          receivedMinor: received,
          eventId: row.event_number ? (events.get(row.event_number) ?? null) : null,
          status: received >= gross ? 'PAID' : due < new Date() ? 'OVERDUE' : received > 0n ? 'PARTIALLY_PAID' : 'ISSUED',
          createdBy: ctx.userId,
        },
      });
      report.imported++;
    }
    return {
      result: report,
      audit: { action: 'migration.open_ar', objectType: 'tenant', objectId: ctx.tenantId, after: { imported: report.imported, skipped: report.skipped } },
    };
  });
  return report;
}

// ── employees.xlsx (без персональных данных — templates/README.md) ──

export async function importEmployeesXlsx(ctx: TenantContext, rows: Row[]): Promise<MigrationReport> {
  requirePermission(ctx, 'tenant.settings');
  const report: MigrationReport = { total: rows.length, imported: 0, skipped: 0, errors: [] };
  const errors = new RowErrors();
  const ccs = new Map((await prisma.costCenter.findMany({ where: { tenantId: ctx.tenantId } })).map((c) => [c.code, c.id]));
  const existing = new Set(
    (await prisma.employee.findMany({ where: { tenantId: ctx.tenantId }, select: { fullName: true } })).map((e) => e.fullName),
  );
  const FLAGS = ['OK', 'MISSING', 'EXPIRED'];

  rows.forEach((row, i) => {
    if (!row.full_name) errors.add(i, 'full_name', 'Обязательное поле');
    if (!row.role_title) errors.add(i, 'role_title', 'Обязательное поле');
    if (row.cost_center_code && !ccs.has(row.cost_center_code)) errors.add(i, 'cost_center_code', 'Cost center не найден');
    if (!['STAFF', 'GPH'].includes(row.employment_type ?? '')) errors.add(i, 'employment_type', 'STAFF / GPH');
    if (!['ACTIVE', 'TERMINATED'].includes(row.status ?? '')) errors.add(i, 'status', 'ACTIVE / TERMINATED');
    if (!FLAGS.includes(row.bank_card_status ?? '')) errors.add(i, 'bank_card_status', 'OK / MISSING / EXPIRED');
    if (!FLAGS.includes(row.passport_status ?? '')) errors.add(i, 'passport_status', 'OK / MISSING / EXPIRED');
  });
  report.errors = errors.errors;
  if (report.errors.length > 0) return report;

  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    for (const row of rows) {
      if (existing.has(row.full_name!)) {
        report.skipped++;
        continue;
      }
      await tx.employee.create({
        data: {
          tenantId: ctx.tenantId,
          fullName: row.full_name!,
          roleTitle: row.role_title!,
          costCenterId: row.cost_center_code ? (ccs.get(row.cost_center_code) ?? null) : null,
          employmentType: row.employment_type as never,
          status: row.status as never,
          terminatedAt: row.terminated_at ? parseDateStr(row.terminated_at) : null,
          bankCardStatus: row.bank_card_status as never,
          passportStatus: row.passport_status as never,
        },
      });
      report.imported++;
    }
    return {
      result: report,
      audit: { action: 'migration.employees', objectType: 'tenant', objectId: ctx.tenantId, after: { imported: report.imported, skipped: report.skipped } },
    };
  });
  return report;
}

// ── budgets.xlsx ──

export async function importBudgetsXlsx(ctx: TenantContext, rows: Row[]): Promise<MigrationReport> {
  requirePermission(ctx, 'budget.manage');
  const report: MigrationReport = { total: rows.length, imported: 0, skipped: 0, errors: [] };
  const errors = new RowErrors();
  const ccs = new Map((await prisma.costCenter.findMany({ where: { tenantId: ctx.tenantId } })).map((c) => [c.code, c.id]));
  const cats = new Map((await prisma.category.findMany({ where: { tenantId: ctx.tenantId } })).map((c) => [c.code, c.id]));

  rows.forEach((row, i) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.period ?? '')) errors.add(i, 'period', 'Период — YYYY-MM');
    if (!ccs.has(row.cost_center_code ?? '')) errors.add(i, 'cost_center_code', 'Cost center не найден');
    if (!cats.has(row.category_code ?? '')) errors.add(i, 'category_code', 'Категория не найдена');
    const planned = parseMoney(row.planned ?? '');
    if (planned === null || planned < 0n) errors.add(i, 'planned', 'Сумма в сумах ≥ 0');
  });
  report.errors = errors.errors;
  if (report.errors.length > 0) return report;

  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    for (const row of rows) {
      const key = {
        tenantId: ctx.tenantId,
        period: row.period!,
        costCenterId: ccs.get(row.cost_center_code!)!,
        categoryId: cats.get(row.category_code!)!,
      };
      const existing = await tx.budget.findUnique({ where: { tenantId_period_costCenterId_categoryId: key } });
      if (existing) {
        report.skipped++;
        continue;
      }
      await tx.budget.create({ data: { ...key, plannedMinor: parseMoney(row.planned!)!, createdBy: ctx.userId } });
      report.imported++;
    }
    return {
      result: report,
      audit: { action: 'migration.budgets', objectType: 'tenant', objectId: ctx.tenantId, after: { imported: report.imported, skipped: report.skipped } },
    };
  });
  return report;
}
