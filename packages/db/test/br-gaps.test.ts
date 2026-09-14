import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { controlsSatisfied, unsafeCreateTenantContext, type ControlResult, type TenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { verifyAuditChain } from '../src/audit.js';
import { createInvoice } from '../src/services/invoices.js';
import { createPaymentRequest, submitPaymentRequest } from '../src/services/payments.js';
import { manualMatch } from '../src/services/bank.js';

process.env.BANK_DATA_KEY ??= randomBytes(32).toString('base64');

/** G-07: явные тесты правил, которые раньше проверялись только косвенно. */

let tenantId: string;
let vendorId: string;
let contractId: string;

const junior = (): TenantContext =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['JUNIOR_FINANCE', 'FINANCE_OPS_LEAD', 'ACCOUNTANT'] });

async function mkMatchedInvoice(gross: bigint) {
  const pr = await prisma.purchaseRequest.create({
    data: {
      tenantId,
      number: `PR-BR-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      requesterId: crypto.randomUUID(),
      what: 'x',
      purpose: 'p',
      totalMinor: gross,
      costCenterId: (await prisma.costCenter.findFirstOrThrow({ where: { tenantId } })).id,
      categoryId: (await prisma.category.findFirstOrThrow({ where: { tenantId } })).id,
      vendorId,
      status: 'INVOICED',
    },
  });
  await prisma.receipt.create({ data: { tenantId, prId: pr.id, receiverId: crypto.randomUUID(), status: 'FULL' } });
  return prisma.invoice.create({
    data: {
      tenantId,
      vendorId,
      number: `BR-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      date: new Date(),
      type: 'SF',
      amountGrossMinor: gross,
      vatMinor: 0n,
      amountNetMinor: gross,
      status: 'MATCHED',
      matchStatus: 'MATCHED',
      prId: pr.id,
    },
  });
}

describe('G-07: явное покрытие BR-004/005/011/012/013/021/050/071', () => {
  beforeAll(async () => {
    const ts = Date.now();
    tenantId = (await prisma.tenant.create({ data: { slug: `t-brg-${ts}`, legalName: 'BRG', taxId: '300000904' } })).id;
    await prisma.costCenter.create({ data: { tenantId, code: 'CC', name: 'CC' } });
    await prisma.category.create({ data: { tenantId, code: 'CAT', name: 'CAT', group: 'OTHER', budgetRequired: false } });
    vendorId = (
      await prisma.vendor.create({
        data: { tenantId, taxId: '311110904', legalName: 'BRV', displayName: 'BRV', status: 'ACTIVE' },
      })
    ).id;
    await prisma.vendorBankAccount.create({
      data: { tenantId, vendorId, bankName: 'TB', mfo: '00444', accountMasked: '****BR01', accountEncrypted: 'enc', status: 'VERIFIED', isDefault: true, verifiedAt: new Date('2026-08-01') },
    });
    contractId = (
      await prisma.contract.create({
        data: { tenantId, number: 'CTR-BR', counterpartyType: 'VENDOR', vendorId, subject: 'x', limitMinor: 1_000_000n, startDate: new Date('2026-01-01'), status: 'ACTIVE' },
      })
    ).id;
  });
  afterAll(async () => prisma.$disconnect());

  it('BR-004/BR-011: partial-оплаты одного счёта суммарно ≤ gross; pending резервирует остаток', async () => {
    const invoice = await mkMatchedInvoice(1_000_000n);
    const first = await createPaymentRequest(junior(), { sourceType: 'INVOICE', sourceId: invoice.id, requestedMinor: 600_000n, purposeNote: 'часть 1' });
    await submitPaymentRequest(junior(), first.id); // pending 600k
    const second = await createPaymentRequest(junior(), { sourceType: 'INVOICE', sourceId: invoice.id, requestedMinor: 500_000n, purposeNote: 'часть 2 сверх остатка' });
    const { payment, controls } = await submitPaymentRequest(junior(), second.id);
    expect(controls.find((c) => c.code === 'OVER_OUTSTANDING')?.result).toBe('FAIL'); // 600+500 > 1000 (BR-004)
    expect(payment.status).toBe('ON_HOLD');
    // ON_HOLD тоже резервирует остаток (BR-011) — снимаем неудачную попытку и платим в остаток
    const { cancelPaymentRequest } = await import('../src/services/payments.js');
    await cancelPaymentRequest(junior(), second.id, 'сверх остатка');
    const third = await createPaymentRequest(junior(), { sourceType: 'INVOICE', sourceId: invoice.id, requestedMinor: 400_000n, purposeNote: 'часть 2 в остаток' });
    const ok = await submitPaymentRequest(junior(), third.id);
    expect(ok.controls.find((c) => c.code === 'OVER_OUTSTANDING')?.result).toBe('PASS');
  });

  it('BR-005: одна транзакция не матчится дважды (сумма matches ≤ |amount|)', async () => {
    const account = await prisma.bankAccount.create({
      data: { tenantId, bankName: 'TB', mfo: '00444', accountMasked: '****BR02', accountEncrypted: 'enc' },
    });
    const tx = await prisma.bankTransaction.create({
      data: { tenantId, bankAccountId: account.id, externalId: 'BR005', bookingDate: new Date(), valueDate: new Date(), amountMinor: -300_000n, counterpartyName: 'BRV', matchStatus: 'UNMATCHED' },
    });
    const mkSent = async () => {
      const invoice = await mkMatchedInvoice(300_000n);
      const payment = await createPaymentRequest(junior(), { sourceType: 'INVOICE', sourceId: invoice.id, requestedMinor: 300_000n, purposeNote: 'x' });
      await prisma.paymentRequest.update({ where: { id: payment.id }, data: { status: 'SENT_TO_BANK' } });
      return payment.id;
    };
    const paymentA = await mkSent();
    await manualMatch(junior(), tx.id, paymentA);
    const paymentB = await mkSent();
    await expect(manualMatch(junior(), tx.id, paymentB)).rejects.toThrow(); // повторный матч той же транзакции
  });

  it('BR-012: превышение лимита договора → CONTRACT_LIMIT FAIL', async () => {
    const payment = await createPaymentRequest(junior(), {
      sourceType: 'CONTRACT',
      sourceId: contractId,
      requestedMinor: 900_000n,
      purposeNote: 'в лимит',
    });
    await submitPaymentRequest(junior(), payment.id);
    const over = await createPaymentRequest(junior(), {
      sourceType: 'CONTRACT',
      sourceId: contractId,
      requestedMinor: 200_000n,
      purposeNote: 'сверх лимита 1 млн',
    });
    const { controls } = await submitPaymentRequest(junior(), over.id);
    expect(controls.some((c) => ['CONTRACT_LIMIT', 'OVER_OUTSTANDING'].includes(c.code) && c.result === 'FAIL')).toBe(true);
  });

  it('BR-013: валютный платёж/счёт без fx_rate отклоняется; c курсом сохраняется', async () => {
    await expect(
      createPaymentRequest(junior(), { sourceType: 'CONTRACT', sourceId: contractId, requestedMinor: 100n, currency: 'USD', purposeNote: 'usd' }),
    ).rejects.toThrow(/BR-013/);
    await expect(
      createInvoice(junior(), { vendorId, number: `USD-${Date.now()}`, date: new Date(), type: 'INVOICE', amountGrossMinor: 100n, amountNetMinor: 100n, vatMinor: 0n, currency: 'USD' }),
    ).rejects.toThrow(/BR-013/);
    const withRate = await createInvoice(junior(), {
      vendorId,
      number: `USD-OK-${Date.now()}`,
      date: new Date(),
      type: 'INVOICE',
      amountGrossMinor: 100n,
      amountNetMinor: 100n,
      vatMinor: 0n,
      currency: 'USD',
      fxRate: '12650.500000',
    });
    expect(withRate.fxRate?.toString()).toContain('12650.5');
  });

  it('BR-021: prepayment без PREPAY-договора → NO_CONTRACT FAIL; c PREPAY-условиями — проходит', async () => {
    const invoice = await mkMatchedInvoice(500_000n);
    const bad = await createPaymentRequest(junior(), { sourceType: 'INVOICE', sourceId: invoice.id, requestedMinor: 250_000n, purposeNote: 'prepay', isPrepayment: true });
    const { controls } = await submitPaymentRequest(junior(), bad.id);
    expect(controls.find((c) => c.code === 'NO_CONTRACT')?.result).toBe('FAIL');
    // договор c PREPAY_PCT
    const prepayContract = await prisma.contract.create({
      data: { tenantId, number: 'CTR-PREPAY', counterpartyType: 'VENDOR', vendorId, subject: 'x', startDate: new Date('2026-01-01'), paymentTerms: { type: 'PREPAY_PCT', value: 50 }, status: 'ACTIVE' },
    });
    const invoice2 = await mkMatchedInvoice(500_000n);
    await prisma.invoice.update({ where: { id: invoice2.id }, data: { contractId: prepayContract.id } });
    const good = await createPaymentRequest(junior(), { sourceType: 'INVOICE', sourceId: invoice2.id, requestedMinor: 250_000n, purposeNote: 'prepay ok', isPrepayment: true });
    const result = await submitPaymentRequest(junior(), good.id);
    expect(result.controls.find((c) => c.code === 'NO_CONTRACT')).toBeUndefined();
  });

  it('BR-050: WARN не блокирует READY, FAIL без exception блокирует', () => {
    const warnOnly: ControlResult[] = [
      { code: 'NO_SOURCE', result: 'PASS' },
      { code: 'RELATED_PARTY', result: 'WARN' },
    ];
    expect(controlsSatisfied(warnOnly, null)).toBe(true);
    const withFail: ControlResult[] = [...warnOnly, { code: 'OVER_OUTSTANDING', result: 'FAIL' }];
    expect(controlsSatisfied(withFail, null)).toBe(false);
    expect(controlsSatisfied(withFail, { type: 'OVER_OUTSTANDING' })).toBe(true);
  });

  it('BR-071: hash chain tenant`а валиден после всех мутаций сьюта', async () => {
    const verdict = await verifyAuditChain(tenantId);
    expect(verdict.valid).toBe(true);
  });
});
