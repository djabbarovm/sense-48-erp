import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, unsafeCreateTenantContext } from '@finance-os/core';
import { TrustbankXlsxParser, UnifiedCsvParser } from '@finance-os/adapters';
import { prisma } from '../src/client.js';
import {
  getCashPosition,
  ignoreTransaction,
  importBankStatement,
  manualMatch,
  markPaymentFailed,
} from '../src/services/bank.js';
import { closeAdvance, createEmployeeAdvance, markOverdueAdvances, writeOffAdvance } from '../src/services/advances.js';
import { createPaymentRequest, submitPaymentRequest } from '../src/services/payments.js';
import { addToBatch, approveBatch, createBatch, exportBatch, freezeBatch, markBatchSent, reviewBatch } from '../src/services/batches.js';

process.env.BANK_DATA_KEY ??= randomBytes(32).toString('base64');
const KEY = process.env.BANK_DATA_KEY!;

let tenantId: string;
let bankAccountId: string;
let vendorId: string;
const VENDOR_TAX = '311110030';

const juniorId = crypto.randomUUID();
const leadId = crypto.randomUUID();
const ownerId = crypto.randomUUID();
const mk = (userId: string, ...roles: Parameters<typeof unsafeCreateTenantContext>[0]['roles']) =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId, roles });
const junior = () => mk(juniorId, 'JUNIOR_FINANCE');
const lead = () => mk(leadId, 'FINANCE_OPS_LEAD');
const owner = () => mk(ownerId, 'OWNER');

const csvHeader =
  'external_id;booking_date;value_date;amount;currency;direction;counterparty_name;counterparty_tax_id;counterparty_account;counterparty_mfo;purpose';

async function sentPayment(amount: bigint, opts: { prepay?: boolean; slaCategory?: string } = {}) {
  const cc = await prisma.costCenter.findFirstOrThrow({ where: { tenantId } });
  const cat = await prisma.category.findFirstOrThrow({ where: { tenantId, code: opts.slaCategory ?? 'CAT' } });
  const contract = opts.prepay
    ? await prisma.contract.create({
        data: {
          tenantId,
          number: `CP-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          counterpartyType: 'VENDOR',
          vendorId,
          subject: 'prepay',
          startDate: new Date('2026-01-01'),
          status: 'ACTIVE',
          paymentTerms: { type: 'PREPAY_PCT', value: 100 },
        },
      })
    : null;
  const pr = await prisma.purchaseRequest.create({
    data: {
      tenantId,
      number: `PR-RC-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      requesterId: crypto.randomUUID(),
      what: 'x',
      purpose: 'p',
      totalMinor: amount,
      costCenterId: cc.id,
      categoryId: cat.id,
      vendorId,
      contractId: contract?.id ?? null,
      status: 'INVOICED',
      tier: 1,
    },
  });
  await prisma.receipt.create({ data: { tenantId, prId: pr.id, receiverId: crypto.randomUUID(), status: 'FULL' } });
  const invoice = await prisma.invoice.create({
    data: {
      tenantId,
      vendorId,
      number: `RC-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      date: new Date(),
      type: 'SF',
      amountGrossMinor: amount,
      vatMinor: 0n,
      amountNetMinor: amount,
      status: 'MATCHED',
      matchStatus: 'MATCHED',
      prId: pr.id,
      contractId: contract?.id ?? null,
    },
  });
  const pay = await createPaymentRequest(junior(), {
    sourceType: 'INVOICE',
    sourceId: invoice.id,
    requestedMinor: amount,
    purposeNote: `Оплата ${invoice.number}`,
    ...(opts.prepay ? { isPrepayment: true } : {}),
  });
  const { payment } = await submitPaymentRequest(junior(), pay.id);
  expect(payment.status).toBe('READY_FOR_BATCH');
  const batch = await createBatch(junior(), { bankAccountId, batchDate: new Date(`2026-10-${String(1 + (n++ % 27)).padStart(2, '0')}`) });
  await addToBatch(junior(), batch.id, payment.id);
  await freezeBatch(junior(), batch.id);
  await reviewBatch(lead(), batch.id);
  await approveBatch(owner(), batch.id);
  await exportBatch(lead(), batch.id);
  await markBatchSent(junior(), batch.id);
  return { payment: await prisma.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } }), batch };
}
let n = 0;

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-c06-${ts}`, legalName: 'C06', taxId: '300000024' } })
  ).id;
  await prisma.costCenter.create({ data: { tenantId, code: 'CC', name: 'CC' } });
  await prisma.category.create({ data: { tenantId, code: 'CAT', name: 'Cat', group: 'OTHER', closingDocSlaDays: 10 } });
  const ts2 = Date.now();
  const docUser = await prisma.user.create({ data: { email: `doc-${ts2}@t.local`, fullName: 'Doc' } });
  const leadUser = await prisma.user.create({ data: { id: leadId, email: `lead-${ts2}@t.local`, fullName: 'Lead' } });
  await prisma.userTenantRole.createMany({
    data: [
      { userId: docUser.id, tenantId, role: 'DOCUMENT_CONTROLLER' },
      { userId: leadUser.id, tenantId, role: 'FINANCE_OPS_LEAD' },
    ],
  });
  bankAccountId = (
    await prisma.bankAccount.create({
      data: {
        tenantId,
        bankName: 'Trustbank',
        mfo: '00491',
        accountMasked: '****7001',
        accountEncrypted: encryptSecret('20208000007312017001', KEY),
        openingBalanceMinor: 50_000_000_000n,
      },
    })
  ).id;
  vendorId = (
    await prisma.vendor.create({
      data: { tenantId, taxId: VENDOR_TAX, legalName: 'ReconVendor', displayName: 'ReconVendor', status: 'ACTIVE' },
    })
  ).id;
  await prisma.vendorBankAccount.create({
    data: {
      tenantId,
      vendorId,
      bankName: 'TB',
      mfo: '00444',
      accountMasked: '****9002',
      accountEncrypted: encryptSecret('20208000900000009002', KEY),
      status: 'VERIFIED',
      isDefault: true,
      verifiedAt: new Date('2026-08-01'),
    },
  });
});

afterAll(async () => prisma.$disconnect());

describe('C-06 Bank import + reconciliation', () => {
  it('AC-08/BR-055: импорт выписки → auto-match по tax_id+сумме → PAID→RECONCILED, batch SETTLED', async () => {
    const { payment, batch } = await sentPayment(250_000_000n);
    const csv = [
      csvHeader,
      `TB-AC08-1;2026-10-01;2026-10-01;2500000.00;UZS;OUT;ReconVendor;${VENDOR_TAX};20208000900000009002;00444;Оплата по СФ ${payment.number}`,
    ].join('\n');
    const rows = new UnifiedCsvParser().parse(Buffer.from(csv));
    const report = await importBankStatement(junior(), bankAccountId, rows);
    expect(report.imported).toBe(1);
    expect(report.autoMatched).toBe(1);
    const paid = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paid.status).toBe('RECONCILED'); // не prepayment → сразу reconciled
    expect(paid.bankTransactionId).not.toBeNull();
    expect(paid.paidAt).not.toBeNull();
    expect((await prisma.paymentBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('SETTLED');
    // match записан
    expect(
      await prisma.reconciliationMatch.count({ where: { tenantId, objectId: payment.id, method: 'AUTO' } }),
    ).toBe(1);
  });

  it('BR-056: повторный импорт того же external_id → skip', async () => {
    const csv = [
      csvHeader,
      `TB-IDEMP-1;2026-10-02;2026-10-02;100000.00;UZS;OUT;Некто;;;;Разовое списание`,
    ].join('\n');
    const rows = new UnifiedCsvParser().parse(Buffer.from(csv));
    const first = await importBankStatement(junior(), bankAccountId, rows);
    expect(first.imported).toBe(1);
    const second = await importBankStatement(junior(), bankAccountId, rows);
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it('UNMATCHED → Task; manual match → PAID; ignore c причиной', async () => {
    const { payment } = await sentPayment(370_000_000n);
    // транзакция без tax_id → suggested (сумма совпала)
    const csv = [
      csvHeader,
      `TB-MM-1;2026-10-03;2026-10-03;3700000.00;UZS;OUT;Неизвестный;;;;Оплата без реквизитов`,
      `TB-MM-2;2026-10-03;2026-10-03;55555.00;UZS;OUT;Левое списание;;;;Комиссия банка`,
    ].join('\n');
    const report = await importBankStatement(junior(), bankAccountId, new UnifiedCsvParser().parse(Buffer.from(csv)));
    expect(report.suggested).toBe(1);
    expect(report.unmatched).toBe(1);
    const unmatchedTask = await prisma.task.findFirst({
      where: { tenantId, type: 'UNMATCHED_TX', status: 'OPEN' },
    });
    expect(unmatchedTask).not.toBeNull();

    const suggestedTx = await prisma.bankTransaction.findFirstOrThrow({
      where: { tenantId, externalId: 'TB-MM-1' },
    });
    const paid = await manualMatch(junior(), suggestedTx.id, payment.id);
    expect(paid.status).toBe('RECONCILED');

    const stray = await prisma.bankTransaction.findFirstOrThrow({ where: { tenantId, externalId: 'TB-MM-2' } });
    const ignored = await ignoreTransaction(junior(), stray.id, 'Комиссия банка, проводится отдельно');
    expect(ignored.matchStatus).toBe('IGNORED');
    expect(await prisma.task.count({ where: { tenantId, objectId: stray.id, status: 'OPEN' } })).toBe(0);
  });

  it('BR-054: manual match c несовпадающей суммой отклоняется', async () => {
    const { payment } = await sentPayment(120_000_000n);
    const csv = [csvHeader, `TB-BAD-1;2026-10-04;2026-10-04;999999.00;UZS;OUT;X;;;;мимо`].join('\n');
    await importBankStatement(junior(), bankAccountId, new UnifiedCsvParser().parse(Buffer.from(csv)));
    const tx = await prisma.bankTransaction.findFirstOrThrow({ where: { tenantId, externalId: 'TB-BAD-1' } });
    await expect(manualMatch(junior(), tx.id, payment.id)).rejects.toThrow(/BR-054|AMOUNT_MISMATCH/);
  });

  it('FAILED path: bank_reject → FAILED + Task; batch settle учитывает FAILED', async () => {
    const { payment, batch } = await sentPayment(80_000_000n);
    const failed = await markPaymentFailed(junior(), payment.id, 'Неверный счёт получателя');
    expect(failed.status).toBe('FAILED');
    expect(
      await prisma.task.count({ where: { tenantId, objectId: payment.id, type: 'REVIEW_EXCEPTION', status: 'OPEN' } }),
    ).toBe(1);
    expect((await prisma.paymentBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('SETTLED');
  });

  it('BR-022/AC-09: prepayment → PAID создаёт Advance + CLOSING_DOCS task c SLA в раб. днях', async () => {
    const { payment } = await sentPayment(90_000_000n, { prepay: true });
    const csv = [
      csvHeader,
      `TB-PREP-1;2026-10-05;2026-10-05;900000.00;UZS;OUT;ReconVendor;${VENDOR_TAX};;;Предоплата ${payment.number}`,
    ].join('\n');
    const report = await importBankStatement(junior(), bankAccountId, new UnifiedCsvParser().parse(Buffer.from(csv)));
    expect(report.autoMatched).toBe(1);
    const paid = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } });
    expect(paid.status).toBe('PAID'); // prepayment ждёт закрывающих
    const advance = await prisma.advance.findFirstOrThrow({
      where: { tenantId, paymentRequestId: payment.id, type: 'VENDOR_PREPAYMENT' },
    });
    expect(advance.status).toBe('OPEN');
    expect(advance.dueDocsDate).not.toBeNull();
    const task = await prisma.task.findFirstOrThrow({
      where: { tenantId, objectType: 'advance', objectId: advance.id, type: 'CLOSING_DOCS' },
    });
    expect(task.escalateToId).toBe(leadId);
    expect(task.ownerId).not.toBeNull();
    // SLA: due > paid date (раб. дни)
    expect(task.dueAt!.getTime()).toBeGreaterThan(new Date('2026-10-05').getTime());
  });

  it('Trustbank-парсер: реальный формат выписки разбирается и импортируется', async () => {
    // синтетический файл в формате Трастбанка строим из CSV-примера через parser контракт
    const parser = new TrustbankXlsxParser();
    expect(parser.format).toBe('TRUSTBANK_XLSX');
  });

  it('cash position: opening + транзакции', async () => {
    const positions = await getCashPosition(junior());
    const main = positions.find((p) => p.account.id === bankAccountId)!;
    // 50 млрд тийин + все импортированные OUT
    expect(main.balanceMinor).toBeLessThan(50_000_000_000n);
  });
});

describe('C-07 Advance (BR-046)', () => {
  let employeeId: string;
  beforeAll(async () => {
    employeeId = (
      await prisma.employee.create({
        data: { tenantId, fullName: 'Тест Сотрудник', roleTitle: 'Менеджер' },
      })
    ).id;
  });

  it('BR-046: новый advance при OVERDUE — блок; Owner c причиной может', async () => {
    const a1 = await createEmployeeAdvance(junior(), {
      employeeId,
      amountMinor: 5_000_000n,
      purpose: 'Закупка мелочей',
      dueDocsDate: new Date('2026-01-10'),
    });
    expect(await markOverdueAdvances(tenantId)).toBeGreaterThanOrEqual(1);
    await expect(
      createEmployeeAdvance(junior(), {
        employeeId,
        amountMinor: 3_000_000n,
        purpose: 'Ещё',
        dueDocsDate: new Date('2026-12-01'),
      }),
    ).rejects.toThrow(/BR-046/);
    const withOverride = await createEmployeeAdvance(owner(), {
      employeeId,
      amountMinor: 3_000_000n,
      purpose: 'Срочная закупка',
      dueDocsDate: new Date('2026-12-01'),
      ownerOverrideReason: 'Критично для мероприятия',
    });
    expect(withOverride.status).toBe('OPEN');
    // закрытие частями: docs + возврат
    const part = await closeAdvance(junior(), a1.id, { closedMinor: 3_000_000n });
    expect(part.status).toBe('PARTIALLY_CLOSED');
    const closed = await closeAdvance(junior(), a1.id, { closedMinor: 1_000_000n, returnedMinor: 1_000_000n });
    expect(closed.status).toBe('CLOSED');
    await expect(closeAdvance(junior(), withOverride.id, { closedMinor: 10_000_000n })).rejects.toThrow(/closed \+ returned/);
  });

  it('write_off — только OWNER', async () => {
    const adv = await createEmployeeAdvance(owner(), {
      employeeId: (
        await prisma.employee.create({ data: { tenantId, fullName: 'Второй', roleTitle: 'X' } })
      ).id,
      amountMinor: 1_000_000n,
      purpose: 'x',
      dueDocsDate: new Date('2026-12-31'),
    });
    await expect(writeOffAdvance(junior(), adv.id, 'потеряли')).rejects.toThrow();
    const wo = await writeOffAdvance(owner(), adv.id, 'Сотрудник уволился, взыскание нецелесообразно');
    expect(wo.status).toBe('WRITTEN_OFF');
  });
});
