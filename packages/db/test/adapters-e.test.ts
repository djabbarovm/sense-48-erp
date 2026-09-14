import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, unsafeCreateTenantContext } from '@finance-os/core';
import { PosCsvAdapter, parseClientBankExchange } from '@finance-os/adapters';
import { exportBatchClientBank } from '../src/services/batches.js';

process.env.BANK_DATA_KEY ??= randomBytes(32).toString('base64');
import { prisma } from '../src/client.js';
import { listEdoMockDocuments, setEdoMockStatus, syncEdoMockDocuments } from '../src/services/edo.js';
import {
  exportPostingsCsv,
  importPostedStatus,
  parsePostedCsv,
  upsertAccountMapping,
} from '../src/services/accounting.js';
import { getEventPosCost, importPosBanquetMapping, importPosDailySales } from '../src/services/pos.js';

let tenantId: string;
let vendorId: string;
let categoryId: string;
let eventId: string;

const lead = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['FINANCE_OPS_LEAD'] });
const admin = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['ADMIN'] });
const acct = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['ACCOUNTANT'] });

describe('E-02/E-03/E-04 adapters', () => {
  beforeAll(async () => {
    const ts = Date.now();
    tenantId = (await prisma.tenant.create({ data: { slug: `t-e0234-${ts}`, legalName: 'E', taxId: '300000111' } })).id;
    vendorId = (
      await prisma.vendor.create({
        data: { tenantId, taxId: '311110040', legalName: 'ООО «Экспорт»', displayName: 'Экспорт', status: 'ACTIVE' },
      })
    ).id;
    categoryId = (
      await prisma.category.create({ data: { tenantId, code: 'E234', name: 'Продукты', group: 'FNB' } })
    ).id;
    eventId = (
      await prisma.event.create({
        data: { tenantId, number: 'EVT-E234', name: 'Банкет', eventDate: new Date('2026-09-20'), status: 'CONFIRMED' },
      })
    ).id;
  });
  afterAll(async () => prisma.$disconnect());

  it('E-02 BR-024: смена статуса в mock-панели → СФ CORRECTED + Task', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        vendorId,
        number: 'СФ-Е02',
        date: new Date('2026-09-01'),
        type: 'SF',
        amountGrossMinor: 100_000_00n,
        vatMinor: 0n,
        amountNetMinor: 100_000_00n,
        status: 'MATCHED',
        matchStatus: 'MATCHED',
        edoDocumentId: 'didox-e02-1',
        edoStatus: 'SIGNED',
      },
    });
    await syncEdoMockDocuments(tenantId, [{ edoDocumentId: 'didox-e02-1', status: 'SIGNED' }]);
    const listed = await listEdoMockDocuments(lead());
    expect(listed.find((d) => d.edoDocumentId === 'didox-e02-1')?.invoice?.number).toBe('СФ-Е02');

    const result = await setEdoMockStatus(lead(), 'didox-e02-1', 'CORRECTED');
    expect(result.invoiceId).toBe(invoice.id);
    const after = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(after!.edoStatus).toBe('CORRECTED');
    expect(after!.status).toBe('CORRECTED');
    const task = await prisma.task.findFirst({ where: { tenantId, objectType: 'invoice', objectId: invoice.id } });
    expect(task?.nextAction).toMatch(/BR-024/);
  });

  it('E-03: daily sales идемпотентен (повтор = update); banquet mapping вяжется к событию', async () => {
    const pos = new PosCsvAdapter();
    const salesCsv = Buffer.from(
      [
        'date;outlet;category;revenue_gross;vat;discounts;cost_of_sales;covers',
        '2026-09-13;ROOFTOP;BAR;12000000.00;1285714.29;300000;4200000;180',
        '2026-09-13;ROOFTOP;KITCHEN;28000000.00;3000000;0;9800000;160',
      ].join('\n'),
    );
    const first = await importPosDailySales(lead(), pos.parseDailySales(salesCsv));
    expect(first).toMatchObject({ imported: 2, updated: 0 });
    const second = await importPosDailySales(lead(), pos.parseDailySales(salesCsv));
    expect(second).toMatchObject({ imported: 0, updated: 2 });

    const banquetCsv = Buffer.from(
      ['iiko_order_id;event_number;food_cost;beverage_cost', 'IIKO-777;EVT-E234;5200000;1900000', 'IIKO-778;НЕТ-ТАКОГО;1;1'].join('\n'),
    );
    const mapping = await importPosBanquetMapping(lead(), pos.parseBanquetMapping(banquetCsv));
    expect(mapping.imported).toBe(1);
    expect(mapping.errors).toHaveLength(1);
    const cost = await getEventPosCost(tenantId, eventId);
    expect(cost.foodCostMinor).toBe(520_000_000n);
    expect(cost.beverageCostMinor).toBe(190_000_000n);
  });

  it('E-04: mapping → export CSV c account_code; import posted → CLOSED c onec_ref', async () => {
    await upsertAccountMapping(admin(), { categoryId, accountCode: '2010', vatAccountCode: '4410' });
    // оплаченный платёж в сентябре
    const account = await prisma.bankAccount.create({
      data: { tenantId, bankName: 'TB', mfo: '00444', accountMasked: '****9999', accountEncrypted: 'enc' },
    });
    const bankTx = await prisma.bankTransaction.create({
      data: {
        tenantId,
        bankAccountId: account.id,
        externalId: 'E04-1',
        bookingDate: new Date('2026-09-05'),
        valueDate: new Date('2026-09-05'),
        amountMinor: -350_000_00n,
        counterpartyName: 'Экспорт',
        matchStatus: 'AUTO_MATCHED',
      },
    });
    const contract = await prisma.contract.create({
      data: { tenantId, number: 'CTR-E04', counterpartyType: 'VENDOR', vendorId, subject: 'x', startDate: new Date('2026-01-01'), status: 'ACTIVE' },
    });
    await prisma.paymentRequest.create({
      data: {
        tenantId,
        number: 'PAY-E04-1',
        sourceType: 'CONTRACT',
        sourceId: contract.id,
        vendorId,
        requestedMinor: 350_000_00n,
        purposeNote: 'Оплата; поставка продуктов',
        categoryId,
        status: 'RECONCILED',
        bankTransactionId: bankTx.id,
        paidAt: new Date('2026-09-05'),
      },
    });

    const csv = (await exportPostingsCsv(acct(), '2026-09')).toString('utf8');
    const lines = csv.split('\n');
    expect(lines[0]).toMatch(/^payment_request_number;paid_at/);
    const row = lines.find((l) => l.startsWith('PAY-E04-1'))!;
    expect(row).toContain(';2010;4410;');
    expect(row).toContain('311110040');
    expect(row).toContain('350000.00'); // 35 000 000 тийин = 350 000,00 сум
    // импорт подтверждения из 1С
    const posted = parsePostedCsv('payment_request_number;posted_at;onec_document_ref\nPAY-E04-1;2026-09-30;1C-000123');
    const report = await importPostedStatus(acct(), posted);
    expect(report.closed).toBe(1);
    const closed = await prisma.paymentRequest.findFirst({ where: { tenantId, number: 'PAY-E04-1' } });
    expect(closed!.status).toBe('CLOSED');
    expect(closed!.onecRef).toBe('1C-000123');
  });

  it('E-04+: выгрузка батча в 1CClientBankExchange (cp1251, МФО в БИК, суммы в сумах)', async () => {
    const key = process.env.BANK_DATA_KEY!;
    const account = await prisma.bankAccount.create({
      data: {
        tenantId,
        bankName: 'Трастбанк',
        mfo: '00491',
        accountMasked: '****1C01',
        accountEncrypted: encryptSecret('20208000900001110001', key),
      },
    });
    const vba = await prisma.vendorBankAccount.create({
      data: {
        tenantId,
        vendorId,
        bankName: 'Ипак Йули',
        mfo: '00421',
        accountMasked: '****2C02',
        accountEncrypted: encryptSecret('20208000900002220002', key),
        status: 'VERIFIED',
      },
    });
    const batch = await prisma.paymentBatch.create({
      data: {
        tenantId,
        number: 'BATCH-1C-TEST',
        batchDate: new Date('2026-09-14'),
        bankAccountId: account.id,
        status: 'APPROVED',
      },
    });
    await prisma.paymentRequest.create({
      data: {
        tenantId,
        number: 'PAY-1C-1',
        sourceType: 'CONTRACT',
        sourceId: crypto.randomUUID(),
        vendorId,
        vendorBankAccountId: vba.id,
        requestedMinor: 1_250_000_000n, // 12 500 000,00 сум
        purposeNote: 'Оплата по СФ 118\nвторая строка',
        status: 'APPROVED',
        batchId: batch.id,
      },
    });
    const { file, fileName } = await exportBatchClientBank(lead(), batch.id);
    expect(fileName).toBe('BATCH-1C-TEST-1c.txt');
    const parsed = parseClientBankExchange(file);
    expect(parsed.header['ВерсияФормата']).toBe('1.02');
    expect(parsed.header['РасчСчет']).toBe('20208000900001110001');
    expect(parsed.orders).toHaveLength(1);
    const order = parsed.orders[0]!;
    expect(order['Сумма']).toBe('12500000.00');
    expect(order['ПолучательБИК']).toBe('00421'); // МФО
    expect(order['ПолучательРасчСчет']).toBe('20208000900002220002');
    expect(order['ПлательщикИНН']).toBe('300000111');
    expect(order['НазначениеПлатежа']).toBe('Оплата по СФ 118 вторая строка'); // без переводов строк
  });
});
