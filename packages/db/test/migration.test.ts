import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { buildTemplateXlsx, parseMigrationSheet } from '@finance-os/adapters';
import { prisma } from '../src/client.js';
import {
  importBudgetsXlsx,
  importContractsXlsx,
  importOpenApXlsx,
  importOpenArXlsx,
  importVendorsXlsx,
} from '../src/services/migration.js';
import { getApAging } from '../src/services/aging.js';

process.env.BANK_DATA_KEY ??= randomBytes(32).toString('base64');

let tenantId: string;
let ownerEmail: string;

const lead = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['FINANCE_OPS_LEAD'] });

describe('E-05 Excel-миграция', () => {
  beforeAll(async () => {
    const ts = Date.now();
    tenantId = (await prisma.tenant.create({ data: { slug: `t-e05-${ts}`, legalName: 'E05', taxId: '300000099' } })).id;
    await prisma.costCenter.create({ data: { tenantId, code: 'CC1', name: 'CC1' } });
    await prisma.category.create({ data: { tenantId, code: 'FNB_FOOD', name: 'FNB', group: 'FNB' } });
    ownerEmail = `e05-${ts}@t.test`;
    const user = await prisma.user.create({ data: { email: ownerEmail, fullName: 'Owner E05' } });
    await prisma.userTenantRole.create({ data: { tenantId, userId: user.id, role: 'REQUESTER' } });
  });
  afterAll(async () => prisma.$disconnect());

  it('шаблон xlsx парсится обратно; заголовки совпадают', () => {
    const buffer = buildTemplateXlsx({
      fileName: 'x.xlsx',
      headers: ['a', 'b'],
      example: [['1', '2']],
      instructions: ['test'],
    });
    const sheet = parseMigrationSheet(buffer);
    expect(sheet.headers).toEqual(['a', 'b']);
    expect(sheet.rows).toEqual([]); // лист «Данные» пуст — примеры на отдельном листе
  });

  it('vendors: all-or-nothing — одна плохая строка блокирует файл; после исправления импорт + идемпотентность', async () => {
    const good = {
      tax_id: '305000001',
      legal_name: 'ООО «Мигрант»',
      display_name: 'Мигрант',
      category_code: 'FNB_FOOD',
      vat_payer: 'Y',
      bank_name: 'Трастбанк',
      mfo: '00491',
      account: '20208000900005000101',
      currency: 'UZS',
      requires_contract: 'N',
      related_party: 'N',
      business_owner_email: ownerEmail,
    };
    const bad = { ...good, tax_id: '12345', legal_name: 'Плохой ИНН' };
    const rejected = await importVendorsXlsx(lead(), [good, bad]);
    expect(rejected.errors).toHaveLength(1);
    expect(rejected.errors[0]).toMatchObject({ row: 3, field: 'tax_id' });
    expect(rejected.imported).toBe(0);
    expect(await prisma.vendor.count({ where: { tenantId } })).toBe(0); // ничего не записано

    const ok = await importVendorsXlsx(lead(), [good]);
    expect(ok.imported).toBe(1);
    const vendor = await prisma.vendor.findFirst({ where: { tenantId, taxId: '305000001' } });
    expect(vendor).not.toBeNull();
    const account = await prisma.vendorBankAccount.findFirst({ where: { vendorId: vendor!.id } });
    expect(account!.status).toBe('VERIFIED');
    expect(account!.accountMasked).toBe('****0101');
    // повтор — skipped
    const again = await importVendorsXlsx(lead(), [good]);
    expect(again).toMatchObject({ imported: 0, skipped: 1 });
  });

  it('contracts + open_ap: paid_to_date уменьшает outstanding через архивный счёт (BR-054 честный)', async () => {
    const contract = await importContractsXlsx(lead(), [
      {
        number: 'ДП-MIG-1',
        vendor_tax_id: '305000001',
        subject: 'Поставка',
        currency: 'UZS',
        limit: '',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        auto_renew: 'N',
        payment_terms_type: 'POSTPAY_DAYS',
        payment_terms_value: '14',
        registration_required: 'N',
        owner_email: ownerEmail,
        status: 'ACTIVE',
      },
    ]);
    expect(contract.imported).toBe(1);

    const ap = await importOpenApXlsx(lead(), [
      {
        vendor_tax_id: '305000001',
        invoice_number: 'МИГ-118',
        invoice_date: '28.08.2026',
        invoice_type: 'SF',
        amount_gross: '12500000',
        vat: '',
        currency: 'UZS',
        contract_number: 'ДП-MIG-1',
        paid_to_date: '5000000',
        due_date: '2026-09-15',
        cost_center_code: 'CC1',
        category_code: 'FNB_FOOD',
        edo_document_id: '',
      },
    ]);
    expect(ap.imported).toBe(1);
    const invoice = await prisma.invoice.findFirst({ where: { tenantId, number: 'МИГ-118' } });
    expect(invoice!.status).toBe('PARTIALLY_PAID');
    expect(invoice!.matchStatus).toBe('MATCHED');
    // AP aging видит остаток 7 500 000 сум
    const aging = await getApAging(lead(), new Date('2026-09-14'));
    const row = aging.find((r) => r.invoices.some((i) => i.number === 'МИГ-118'))!;
    expect(row.invoices.find((i) => i.number === 'МИГ-118')!.outstandingMinor).toBe(750_000_000n);
    // архивный счёт вне cash position
    const migAccount = await prisma.bankAccount.findFirst({ where: { tenantId, accountMasked: '****MIGR' } });
    expect(migAccount!.isActive).toBe(false);
  });

  it('open_ar: клиент создаётся, просрочка → OVERDUE; budgets идемпотентны', async () => {
    const ar = await importOpenArXlsx(lead(), [
      {
        customer_tax_id: '205000001',
        customer_name: 'ООО «Клиент Миграции»',
        invoice_number: 'СЧ-МИГ-1',
        invoice_date: '2026-08-20',
        amount_gross: '9000000',
        vat: '',
        currency: 'UZS',
        due_date: '2026-08-30',
        received_to_date: '2000000',
        event_number: '',
        contract_number: '',
      },
    ]);
    expect(ar.imported).toBe(1);
    const cinv = await prisma.customerInvoice.findFirst({ where: { tenantId, number: 'СЧ-МИГ-1' } });
    expect(cinv!.status).toBe('OVERDUE');
    expect(cinv!.receivedMinor).toBe(200_000_000n);

    const budgets = await importBudgetsXlsx(lead(), [
      { period: '2026-10', cost_center_code: 'CC1', category_code: 'FNB_FOOD', planned: '95000000' },
    ]);
    expect(budgets.imported).toBe(1);
    const again = await importBudgetsXlsx(lead(), [
      { period: '2026-10', cost_center_code: 'CC1', category_code: 'FNB_FOOD', planned: '95000000' },
    ]);
    expect(again).toMatchObject({ imported: 0, skipped: 1 });
  });
});
