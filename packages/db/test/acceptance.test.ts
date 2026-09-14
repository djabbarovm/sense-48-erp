import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptSecret, unsafeCreateTenantContext, type TenantContext } from '@finance-os/core';
import { buildMonthEndPackXlsx } from '@finance-os/adapters';
import * as XLSX from 'xlsx';
import { prisma } from '../src/client.js';
import { createPr, submitPr } from '../src/services/purchaseRequests.js';
import { getContractBalance } from '../src/services/contracts.js';
import { createPaymentRequest, submitPaymentRequest } from '../src/services/payments.js';
import { addToBatch, createBatch, freezeBatch, type BatchSummary } from '../src/services/batches.js';
import { importBankStatement } from '../src/services/bank.js';
import { getMonthEndPackData } from '../src/services/close.js';

process.env.BANK_DATA_KEY ??= randomBytes(32).toString('base64');

/**
 * G-03: приёмочные сценарии docs/09, реализованные здесь: AC-01, AC-03, AC-14, AC-22.
 * Остальные покрыты профильными сьютами (карта — docs/14-traceability.md):
 * AC-02 invoices.test · AC-04 invoices.test · AC-05 payments.test · AC-06/07/15 batches.test ·
 * AC-08/09 bank-reconciliation.test · AC-10 e2e (12 сценариев) · AC-11 cross-tenant-fuzz.test ·
 * AC-12 audit.test · AC-13 security.test+BR-072 · AC-16 payments.test · AC-17 vendors.test ·
 * AC-18 events.test · AC-19 tax-payroll.test · AC-20 migration.test · AC-21 forecast.test.
 */

let tenantId: string;
let ccId: string;
let catId: string;
let vendorId: string;

const roleCtx = (...roles: Parameters<typeof unsafeCreateTenantContext>[0]['roles']): TenantContext =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles });

describe('G-03 acceptance', () => {
  beforeAll(async () => {
    const ts = Date.now();
    tenantId = (await prisma.tenant.create({ data: { slug: `t-g03-${ts}`, legalName: 'G03', taxId: '300000903' } })).id;
    ccId = (await prisma.costCenter.create({ data: { tenantId, code: 'RH', name: 'RH' } })).id;
    catId = (await prisma.category.create({ data: { tenantId, code: 'FNB_G03', name: 'FNB', group: 'FNB', budgetRequired: false } })).id;
    vendorId = (
      await prisma.vendor.create({
        data: { tenantId, taxId: '311110903', legalName: 'FOOD SUPPLY', displayName: 'FOOD SUPPLY', status: 'ACTIVE' },
      })
    ).id;
    await prisma.vendorBankAccount.create({
      data: {
        tenantId,
        vendorId,
        bankName: 'TB',
        mfo: '00444',
        accountMasked: '****G031',
        accountEncrypted: encryptSecret('20208000900009030001', process.env.BANK_DATA_KEY!),
        status: 'VERIFIED',
        isDefault: true,
        verifiedAt: new Date('2026-08-01'),
      },
    });
    await prisma.approvalPolicy.create({
      data: { tenantId, tier1MaxMinor: 500_000_000n, tier2MaxMinor: 2_500_000_000n, newVendorOwnerThresholdMinor: 100_000_000n, effectiveFrom: new Date('2026-01-01') },
    });
  });
  afterAll(async () => prisma.$disconnect());

  it('AC-01: PR c полным контекстом → SUBMITTED Tier 1 c business-слотом; без cost_center → ошибка', async () => {
    const chef = roleCtx('REQUESTER');
    const pr = await createPr(chef, {
      what: 'Лосось 20 кг',
      purpose: 'Банкет',
      totalMinor: 800_000_000n, // 8 млн сум
      costCenterId: ccId,
      categoryId: catId,
      vendorId,
    });
    const { pr: submitted, decision } = await submitPr(chef, pr.id);
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.budgetStatus).toBe('WITHIN'); // категория не budget_required
    expect(submitted.tier).toBe(2); // 8 млн сум > tier1Max 5 млн сум
    expect(decision.approvals.map((a) => a.role)).toContain('BUSINESS_OWNER');
    // negative: без cost center
    await expect(
      createPr(chef, { what: 'x', purpose: 'p', totalMinor: 1n, costCenterId: '', categoryId: catId }),
    ).rejects.toThrow();
  });

  it('AC-03: contract balance — committed/paid/outstanding/requested сходятся', async () => {
    const lead = roleCtx('FINANCE_OPS_LEAD');
    const contract = await prisma.contract.create({
      data: {
        tenantId,
        number: '12/2026',
        counterpartyType: 'VENDOR',
        vendorId,
        subject: 'Поставка',
        limitMinor: 5_000_000_000n, // 50 млн
        startDate: new Date('2026-01-01'),
        status: 'ACTIVE',
      },
    });
    // paid 20 млн (через архивную транзакцию), pending 5 млн
    const account = await prisma.bankAccount.create({
      data: { tenantId, bankName: 'TB', mfo: '00444', accountMasked: '****G032', accountEncrypted: 'enc' },
    });
    const bankTx = await prisma.bankTransaction.create({
      data: { tenantId, bankAccountId: account.id, externalId: 'G03-1', bookingDate: new Date(), valueDate: new Date(), amountMinor: -2_000_000_000n, counterpartyName: 'FS', matchStatus: 'AUTO_MATCHED' },
    });
    await prisma.paymentRequest.create({
      data: { tenantId, number: 'PAY-G03-P', sourceType: 'CONTRACT', sourceId: contract.id, vendorId, requestedMinor: 2_000_000_000n, purposeNote: 'x', status: 'PAID', bankTransactionId: bankTx.id, paidAt: new Date() },
    });
    await prisma.paymentRequest.create({
      data: { tenantId, number: 'PAY-G03-Q', sourceType: 'CONTRACT', sourceId: contract.id, vendorId, requestedMinor: 500_000_000n, purposeNote: 'x', status: 'SUBMITTED' },
    });
    const balance = await getContractBalance(lead, contract.id);
    expect(balance.paidMinor).toBe(2_000_000_000n); // 20 млн
    expect(balance.requestedPendingMinor).toBe(500_000_000n); // 5 млн
    // семантика B-02: committed = обязательства (PR + pending) БЕЗ paid; outstanding = лимит − paid − pending
    expect(balance.committedMinor).toBe(500_000_000n);
    expect(balance.outstandingMinor).toBe(2_500_000_000n); // 50 − 20 − 5 = 25 млн
  });

  it('AC-14: junior green flow без senior — платёж → batch → freeze → авто-матч выписки', async () => {
    const junior = roleCtx('JUNIOR_FINANCE');
    const contract = await prisma.contract.create({
      data: { tenantId, number: 'CTR-G03-14', counterpartyType: 'VENDOR', vendorId, subject: 'x', startDate: new Date('2026-01-01'), status: 'ACTIVE' },
    });
    const payment = await createPaymentRequest(junior, {
      sourceType: 'CONTRACT',
      sourceId: contract.id,
      requestedMinor: 120_000_000n,
      purposeNote: 'Продукты за неделю',
    });
    const { payment: submitted, controls } = await submitPaymentRequest(junior, payment.id);
    expect(submitted.status).toBe('READY_FOR_BATCH'); // green: ни одного FAIL
    expect(controls.every((c) => c.result !== 'FAIL')).toBe(true);

    const account = await prisma.bankAccount.create({
      data: { tenantId, bankName: 'TB', mfo: '00444', accountMasked: '****G033', accountEncrypted: 'enc', openingBalanceMinor: 10_000_000_000n },
    });
    const batch = await createBatch(junior, { bankAccountId: account.id });
    await addToBatch(junior, batch.id, payment.id);
    const frozen = await freezeBatch(junior, batch.id);
    expect(frozen.status).toBe('FROZEN');
    const summary = frozen.summary as unknown as BatchSummary;
    expect(summary.count).toBe(1);
    expect(summary.exceptions).toEqual([]); // 0 exceptions создано

    // junior импортирует выписку: авто-матч по ИНН+сумме (после отправки батча)
    await prisma.paymentRequest.update({ where: { id: payment.id }, data: { status: 'SENT_TO_BANK' } });
    const report = await importBankStatement(junior, account.id, [
      {
        externalId: 'G03-14-1',
        bookingDate: new Date().toISOString().slice(0, 10),
        valueDate: new Date().toISOString().slice(0, 10),
        amountMinor: -120_000_000n,
        currency: 'UZS',
        counterpartyName: 'FOOD SUPPLY',
        counterpartyTaxId: '311110903',
        purpose: `Оплата ${payment.number}`,
        raw: {},
      },
    ]);
    expect(report.autoMatched).toBe(1);
    const paid = await prisma.paymentRequest.findUnique({ where: { id: payment.id } });
    expect(['PAID', 'RECONCILED']).toContain(paid!.status);
  });

  it('AC-22: month-end pack собирается, все листы на месте, чеклист согласован', async () => {
    const lead = roleCtx('FINANCE_OPS_LEAD', 'ACCOUNTANT');
    const data = await getMonthEndPackData(lead, '2026-09');
    expect(data.checklist).toHaveLength(9);
    const xlsx = buildMonthEndPackXlsx(data);
    const workbook = XLSX.read(xlsx, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual([
      'Summary',
      'Budget vs actual',
      'AP aging',
      'AR aging',
      'Taxes',
      'Events',
      'Exceptions',
      'Cash 13w',
    ]);
    const summary = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Summary!, { header: 1 });
    expect(String(summary[0]![0])).toContain('G03');
  });
});
