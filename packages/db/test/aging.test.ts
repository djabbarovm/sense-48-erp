import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { bucketOf, getApAging, parseStatementCsv, reconcileVendorStatement } from '../src/services/aging.js';

let tenantId: string;
let vendorId: string;
let otherVendorId: string;
let contractId: string;

const ctx = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['ACCOUNTANT'] });

const NOW = new Date('2026-09-14T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000);

async function mkInvoice(number: string, gross: bigint, date: Date, over: Record<string, unknown> = {}) {
  return prisma.invoice.create({
    data: {
      tenantId,
      vendorId,
      number,
      date,
      type: 'SF',
      amountGrossMinor: gross,
      vatMinor: 0n,
      amountNetMinor: gross,
      status: 'MATCHED',
      matchStatus: 'MATCHED',
      ...over,
    } as never,
  });
}

describe('D-01 AP aging + vendor statement reconciliation', () => {
  beforeAll(async () => {
    const ts = Date.now();
    tenantId = (await prisma.tenant.create({ data: { slug: `t-d01-${ts}`, legalName: 'D01', taxId: '300000033' } })).id;
    vendorId = (
      await prisma.vendor.create({
        data: { tenantId, taxId: '311110020', legalName: 'AgingVendor', displayName: 'AgingVendor', status: 'ACTIVE' },
      })
    ).id;
    otherVendorId = (
      await prisma.vendor.create({
        data: { tenantId, taxId: '311110021', legalName: 'Other', displayName: 'Other', status: 'ACTIVE' },
      })
    ).id;
    contractId = (
      await prisma.contract.create({
        data: {
          tenantId,
          number: 'CTR-D01',
          counterpartyType: 'VENDOR',
          vendorId,
          subject: 'x',
          startDate: daysAgo(200),
          paymentTerms: { type: 'POSTPAY_DAYS', value: 14 },
          status: 'ACTIVE',
        },
      })
    ).id;
  });
  afterAll(async () => prisma.$disconnect());

  it('buckets NOT_DUE / 1-7 / 8-30 / 31-60 / 60+ по дате due', () => {
    expect(bucketOf(new Date('2026-09-20'), NOW)).toBe('NOT_DUE');
    expect(bucketOf(daysAgo(3), NOW)).toBe('D1_7');
    expect(bucketOf(daysAgo(20), NOW)).toBe('D8_30');
    expect(bucketOf(daysAgo(45), NOW)).toBe('D31_60');
    expect(bucketOf(daysAgo(90), NOW)).toBe('D60_PLUS');
  });

  it('aging: outstanding за вычетом PAID, contract terms сдвигают due, оплаченный счёт исчезает', async () => {
    // без договора: due = date → 10 дней просрочки → D8_30
    await mkInvoice('A-1', 500_000_00n, daysAgo(10));
    // c договором POSTPAY 14: date 10 дней назад → due через 4 дня → NOT_DUE
    await mkInvoice('A-2', 300_000_00n, daysAgo(10), { contractId });
    // частично оплачен: 200 из 700 → 500 в D60_PLUS
    const inv3 = await mkInvoice('A-3', 700_000_00n, daysAgo(90));
    await prisma.paymentRequest.create({
      data: {
        tenantId,
        number: 'PAY-D01-1',
        sourceType: 'INVOICE',
        sourceId: inv3.id,
        vendorId,
        requestedMinor: 200_000_00n,
        purposeNote: 'x',
        status: 'SENT_TO_BANK',
      },
    });
    // BR-054: PAID только через транзакцию — создаём и матчим
    const account = await prisma.bankAccount.create({
      data: { tenantId, bankName: 'TB', mfo: '00444', accountMasked: '****1111', accountEncrypted: 'enc' },
    });
    const tx = await prisma.bankTransaction.create({
      data: {
        tenantId,
        bankAccountId: account.id,
        externalId: 'D01-1',
        bookingDate: NOW,
        valueDate: NOW,
        amountMinor: -200_000_00n,
        counterpartyName: 'AgingVendor',
        matchStatus: 'AUTO_MATCHED',
      },
    });
    await prisma.paymentRequest.updateMany({
      where: { tenantId, number: 'PAY-D01-1' },
      data: { status: 'PAID', bankTransactionId: tx.id },
    });
    // полностью оплаченный счёт не попадает
    const inv4 = await mkInvoice('A-4', 100_000_00n, daysAgo(40));
    const tx2 = await prisma.bankTransaction.create({
      data: {
        tenantId,
        bankAccountId: account.id,
        externalId: 'D01-2',
        bookingDate: NOW,
        valueDate: NOW,
        amountMinor: -100_000_00n,
        counterpartyName: 'AgingVendor',
        matchStatus: 'AUTO_MATCHED',
      },
    });
    await prisma.paymentRequest.create({
      data: {
        tenantId,
        number: 'PAY-D01-2',
        sourceType: 'INVOICE',
        sourceId: inv4.id,
        vendorId,
        requestedMinor: 100_000_00n,
        purposeNote: 'x',
        status: 'PAID',
        bankTransactionId: tx2.id,
      },
    });

    const rows = await getApAging(ctx(), NOW);
    const row = rows.find((r) => r.vendorId === vendorId)!;
    expect(row.buckets.D8_30).toBe(500_000_00n);
    expect(row.buckets.NOT_DUE).toBe(300_000_00n);
    expect(row.buckets.D60_PLUS).toBe(500_000_00n);
    expect(row.totalMinor).toBe(1_300_000_00n);
    expect(row.invoices.find((i) => i.number === 'A-4')).toBeUndefined();
  });

  it('tenant isolation: чужой tenant не видит aging (BR-073)', async () => {
    const foreign = unsafeCreateTenantContext({
      tenantId: (await prisma.tenant.create({ data: { slug: `t-d01b-${Date.now()}`, legalName: 'B', taxId: '300000034' } })).id,
      tenantSlug: 'y',
      userId: crypto.randomUUID(),
      roles: ['ACCOUNTANT'],
    });
    expect(await getApAging(foreign, NOW)).toEqual([]);
  });

  it('акт сверки: matched / amountMismatch / missing в обе стороны; CSV-парсер', async () => {
    void otherVendorId;
    const statement = parseStatementCsv(
      ['number;date;amount', 'A-1;2026-09-04;500 000,00', 'A-2;2026-09-04;999,99', 'X-77;2026-08-01;120000'].join('\n'),
    );
    expect(statement).toHaveLength(3);
    const diff = await reconcileVendorStatement(ctx(), vendorId, statement);
    expect(diff.matched.map((m) => m.number)).toEqual(['A-1']);
    expect(diff.amountMismatch[0]).toMatchObject({ number: 'A-2', systemMinor: 300_000_00n });
    expect(diff.missingInSystem.map((m) => m.number)).toEqual(['X-77']);
    expect(diff.missingInStatement.map((m) => m.number).sort()).toEqual(['A-3', 'A-4']);
  });
});
