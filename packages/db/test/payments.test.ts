import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { unsafeCreateTenantContext, type ControlResult } from '@finance-os/core';
import { prisma } from '../src/client.js';
import {
  approvePaymentException,
  cancelPaymentRequest,
  createPaymentRequest,
  resolvePaymentHold,
  submitPaymentRequest,
} from '../src/services/payments.js';
import { seedDefaultRequirements, markDocumentReceived, uploadDocument } from '../src/services/documents.js';
import { LocalFsStorage } from '@finance-os/adapters';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BANK_DATA_KEY ??= randomBytes(32).toString('base64');

let tenantId: string;
let vendorId: string;
let verifiedAccountId: string;
let unverifiedVendorId: string;
let ccId: string;
let fnbCatId: string; // budgetRequired false в этом тесте
let mktCatId: string;
const storage = new LocalFsStorage(mkdtempSync(join(tmpdir(), 'fos-pay-')));

const juniorId = crypto.randomUUID();
const leadId = crypto.randomUUID();
const mk = (userId: string, ...roles: Parameters<typeof unsafeCreateTenantContext>[0]['roles']) =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId, roles });
const junior = () => mk(juniorId, 'JUNIOR_FINANCE');
const lead = () => mk(leadId, 'FINANCE_OPS_LEAD');
const docCtrl = () => mk(crypto.randomUUID(), 'DOCUMENT_CONTROLLER');

const controlsOf = (p: { controlsResult: unknown }) => p.controlsResult as ControlResult[];
const control = (p: { controlsResult: unknown }, code: string) =>
  controlsOf(p).find((c) => c.code === code);

async function mkInvoice(over: Partial<Parameters<typeof prisma.invoice.create>[0]['data']> = {}) {
  return prisma.invoice.create({
    data: {
      tenantId,
      vendorId,
      number: `I-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: new Date(),
      type: 'SF',
      amountGrossMinor: 400_000_000n,
      vatMinor: 0n,
      amountNetMinor: 400_000_000n,
      status: 'MATCHED',
      matchStatus: 'MATCHED',
      ...over,
    },
  });
}

async function mkMatchedInvoiceWithPr() {
  const pr = await prisma.purchaseRequest.create({
    data: {
      tenantId,
      number: `PR-PAY-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      requesterId: crypto.randomUUID(),
      what: 'x',
      purpose: 'p',
      totalMinor: 400_000_000n,
      costCenterId: ccId,
      categoryId: fnbCatId,
      vendorId,
      status: 'INVOICED',
      tier: 1,
    },
  });
  await prisma.receipt.create({ data: { tenantId, prId: pr.id, receiverId: crypto.randomUUID(), status: 'FULL' } });
  const invoice = await mkInvoice({ prId: pr.id });
  return { pr, invoice };
}

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-c01-${ts}`, legalName: 'C01', taxId: '300000022' } })
  ).id;
  ccId = (await prisma.costCenter.create({ data: { tenantId, code: 'CC', name: 'CC' } })).id;
  fnbCatId = (
    await prisma.category.create({ data: { tenantId, code: 'FNB_X', name: 'FNB', group: 'OTHER', budgetRequired: false } })
  ).id;
  mktCatId = (
    await prisma.category.create({ data: { tenantId, code: 'MKT_X', name: 'MKT', group: 'MARKETING', budgetRequired: true } })
  ).id;
  vendorId = (
    await prisma.vendor.create({
      data: { tenantId, taxId: '311110010', legalName: 'PayVendor', displayName: 'PayVendor', status: 'ACTIVE' },
    })
  ).id;
  verifiedAccountId = (
    await prisma.vendorBankAccount.create({
      data: {
        tenantId,
        vendorId,
        bankName: 'TB',
        mfo: '00444',
        accountMasked: '****0001',
        accountEncrypted: 'enc',
        status: 'VERIFIED',
        isDefault: true,
        verifiedAt: new Date('2026-08-01'),
      },
    })
  ).id;
  unverifiedVendorId = (
    await prisma.vendor.create({
      data: { tenantId, taxId: '311110011', legalName: 'Unv', displayName: 'Unv', status: 'ACTIVE' },
    })
  ).id;
  await prisma.vendorBankAccount.create({
    data: {
      tenantId,
      vendorId: unverifiedVendorId,
      bankName: 'TB',
      mfo: '00444',
      accountMasked: '****0002',
      accountEncrypted: 'enc',
      status: 'UNVERIFIED',
    },
  });
});

afterAll(async () => prisma.$disconnect());

describe('C-01 PaymentRequest + run_controls', () => {
  it('BR-001: платёж без source отклоняется; с несуществующим source → 404', async () => {
    await expect(
      createPaymentRequest(junior(), {
        sourceType: 'INVOICE',
        sourceId: '',
        requestedMinor: 100n,
        purposeNote: 'x',
      }),
    ).rejects.toThrow(/BR-001|NO_SOURCE/);
    await expect(
      createPaymentRequest(junior(), {
        sourceType: 'INVOICE',
        sourceId: crypto.randomUUID(),
        requestedMinor: 100n,
        purposeNote: 'x',
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('green flow: matched invoice + receipt + verified счёт → READY_FOR_BATCH', async () => {
    const { invoice } = await mkMatchedInvoiceWithPr();
    const pay = await createPaymentRequest(junior(), {
      sourceType: 'INVOICE',
      sourceId: invoice.id,
      requestedMinor: 400_000_000n,
      purposeNote: 'Оплата по СФ',
    });
    expect(pay.number).toMatch(/^PAY-\d{4}-\d{6}$/);
    expect(pay.vendorBankAccountId).toBe(verifiedAccountId);
    const { payment } = await submitPaymentRequest(junior(), pay.id);
    expect(payment.status).toBe('READY_FOR_BATCH');
    expect(control(payment, 'OVER_OUTSTANDING')?.result).toBe('PASS');
    expect(control(payment, 'UNVERIFIED_BANK')?.result).toBe('PASS');
  });

  it('BR-031: UNVERIFIED счёт → ON_HOLD c UNVERIFIED_BANK FAIL + Task', async () => {
    const invoice = await mkInvoice({ vendorId: unverifiedVendorId, prId: null });
    const pay = await createPaymentRequest(junior(), {
      sourceType: 'INVOICE',
      sourceId: invoice.id,
      requestedMinor: 100_000_000n,
      purposeNote: 'x',
    });
    const { payment } = await submitPaymentRequest(junior(), pay.id);
    expect(payment.status).toBe('ON_HOLD');
    expect(control(payment, 'UNVERIFIED_BANK')?.result).toBe('FAIL');
    expect(
      await prisma.task.count({ where: { tenantId, objectType: 'payment_request', objectId: pay.id, status: 'OPEN' } }),
    ).toBe(1);
  });

  it('BR-010/011: OVER_OUTSTANDING учитывает paid и pending; AC-16 exception → READY', async () => {
    const { invoice } = await mkMatchedInvoiceWithPr(); // gross 400M
    // первый платёж на 300M — pending
    const p1 = await createPaymentRequest(junior(), {
      sourceType: 'INVOICE',
      sourceId: invoice.id,
      requestedMinor: 300_000_000n,
      purposeNote: 'part 1',
    });
    await submitPaymentRequest(junior(), p1.id);
    // второй на 200M — превышает остаток 100M
    const p2 = await createPaymentRequest(junior(), {
      sourceType: 'INVOICE',
      sourceId: invoice.id,
      requestedMinor: 200_000_000n,
      purposeNote: 'part 2',
    });
    const { payment } = await submitPaymentRequest(junior(), p2.id);
    expect(payment.status).toBe('ON_HOLD');
    expect(control(payment, 'OVER_OUTSTANDING')?.result).toBe('FAIL');
    // junior не может исключение
    await expect(approvePaymentException(junior(), p2.id, 'OVER_OUTSTANDING', 'доплата')).rejects.toThrow();
    // lead approve exception → READY, audit
    const resolved = await approvePaymentException(lead(), p2.id, 'OVER_OUTSTANDING', 'Доплата за доставку по согласованию');
    expect(resolved.status).toBe('READY_FOR_BATCH');
    expect(
      await prisma.auditLog.count({
        where: { tenantId, action: 'payment_request.exception_approved', objectId: p2.id },
      }),
    ).toBe(1);
  });

  it('BR-003: дубликат (vendor, amount, due±3d) → DUP_PAYMENT_SUSPECT FAIL', async () => {
    const { invoice: inv1 } = await mkMatchedInvoiceWithPr();
    const { invoice: inv2 } = await mkMatchedInvoiceWithPr();
    const due = new Date('2026-09-20');
    const p1 = await createPaymentRequest(junior(), {
      sourceType: 'INVOICE',
      sourceId: inv1.id,
      requestedMinor: 400_000_000n,
      purposeNote: 'x',
      dueDate: due,
    });
    await submitPaymentRequest(junior(), p1.id);
    const p2 = await createPaymentRequest(junior(), {
      sourceType: 'INVOICE',
      sourceId: inv2.id,
      requestedMinor: 400_000_000n,
      purposeNote: 'y',
      dueDate: new Date('2026-09-22'),
    });
    const { payment } = await submitPaymentRequest(junior(), p2.id);
    expect(control(payment, 'DUP_PAYMENT_SUSPECT')?.result).toBe('FAIL');
    expect(payment.status).toBe('ON_HOLD');
  });

  it('BR-020: postpay без receipt/match → NO_RECEIPT + INVOICE_UNMATCHED + NO_PR', async () => {
    const invoice = await mkInvoice({ status: 'RECEIVED', matchStatus: 'UNMATCHED', prId: null });
    const pay = await createPaymentRequest(junior(), {
      sourceType: 'INVOICE',
      sourceId: invoice.id,
      requestedMinor: 100_000_000n,
      purposeNote: 'x',
    });
    const { payment } = await submitPaymentRequest(junior(), pay.id);
    expect(control(payment, 'INVOICE_UNMATCHED')?.result).toBe('FAIL');
    expect(control(payment, 'NO_PR')?.result).toBe('FAIL');
  });

  it('BR-002: DUPLICATE_SUSPECT invoice → INVOICE_DUPLICATE_SUSPECT FAIL (AC-04)', async () => {
    const original = await mkInvoice({});
    const dup = await mkInvoice({ number: original.number, date: original.date, status: 'DUPLICATE_SUSPECT', duplicateOfId: original.id });
    const pay = await createPaymentRequest(junior(), {
      sourceType: 'INVOICE',
      sourceId: dup.id,
      requestedMinor: 100n,
      purposeNote: 'x',
    });
    const { payment } = await submitPaymentRequest(junior(), pay.id);
    expect(control(payment, 'INVOICE_DUPLICATE_SUSPECT')?.result).toBe('FAIL');
  });

  it('BR-023/AC-05: MISSING_DOC:ACT для MARKETING postpay → ON_HOLD; загрузка акта + resolve → READY', async () => {
    await seedDefaultRequirements(tenantId);
    const pr = await prisma.purchaseRequest.create({
      data: {
        tenantId,
        number: `PR-MKT-${Date.now()}`,
        requesterId: crypto.randomUUID(),
        what: 'SMM',
        purpose: 'p',
        totalMinor: 100_000_000n,
        costCenterId: ccId,
        categoryId: mktCatId,
        vendorId,
        status: 'APPROVED',
        tier: 1,
      },
    });
    // бюджет для категории (иначе UNBUDGETED затмит тест)
    await prisma.budget.upsert({
      where: {
        tenantId_period_costCenterId_categoryId: {
          tenantId,
          period: new Date().toISOString().slice(0, 7),
          costCenterId: ccId,
          categoryId: mktCatId,
        },
      },
      create: {
        tenantId,
        period: new Date().toISOString().slice(0, 7),
        costCenterId: ccId,
        categoryId: mktCatId,
        plannedMinor: 1_000_000_000n,
      },
      update: {},
    });
    const pay = await createPaymentRequest(junior(), {
      sourceType: 'PR',
      sourceId: pr.id,
      requestedMinor: 100_000_000n,
      purposeNote: 'Оплата услуг',
    });
    const { payment } = await submitPaymentRequest(junior(), pay.id);
    expect(payment.status).toBe('ON_HOLD');
    expect(controlsOf(payment).some((c) => c.code === 'MISSING_DOC:ACT' && c.result === 'FAIL')).toBe(true);
    const task = await prisma.task.findFirstOrThrow({
      where: { tenantId, objectType: 'payment_request', objectId: pay.id, status: 'OPEN' },
    });
    expect(task.type).toBe('MISSING_DOC');
    expect(task.nextAction).toContain('MISSING_DOC');
    // doc controller загружает акт и счёт, mark_received → resolve → READY
    for (const dt of ['ACT', 'INVOICE'] as const) {
      const d = await uploadDocument(docCtrl(), storage, {
        objectType: 'payment_request',
        objectId: pay.id,
        docType: dt,
        fileName: `${dt.toLowerCase()}.pdf`,
        mime: 'application/pdf',
        body: Buffer.from(dt),
      });
      await markDocumentReceived(docCtrl(), d.id);
    }
    const { payment: after } = await resolvePaymentHold(junior(), pay.id);
    expect(after.status).toBe('READY_FOR_BATCH');
    expect(
      await prisma.task.count({ where: { tenantId, objectId: pay.id, status: 'OPEN' } }),
    ).toBe(0);
  });

  it('BR-054 (DB): прямой UPDATE в PAID без bank_transaction_id отклоняется триггером', async () => {
    const { invoice } = await mkMatchedInvoiceWithPr();
    const pay = await createPaymentRequest(junior(), {
      sourceType: 'INVOICE',
      sourceId: invoice.id,
      requestedMinor: 400_000_000n,
      purposeNote: 'x',
    });
    await expect(
      prisma.$executeRawUnsafe(`UPDATE payment_request SET status = 'PAID' WHERE id = '${pay.id}'`),
    ).rejects.toThrow(/PAID_REQUIRES_BANK_CONFIRMATION/);
  });

  it('cancel: создатель до READY; risk-флаги дают WARN, не блокируют', async () => {
    const riskVendor = await prisma.vendor.create({
      data: {
        tenantId,
        taxId: '311110012',
        legalName: 'RP',
        displayName: 'RP',
        status: 'ACTIVE',
        riskFlags: ['RELATED_PARTY', 'NEW'],
      },
    });
    await prisma.vendorBankAccount.create({
      data: {
        tenantId,
        vendorId: riskVendor.id,
        bankName: 'TB',
        mfo: '00444',
        accountMasked: '****0003',
        accountEncrypted: 'enc',
        status: 'VERIFIED',
        isDefault: true,
        verifiedAt: new Date('2026-08-01'),
      },
    });
    const invoice = await mkInvoice({ vendorId: riskVendor.id, prId: null, matchStatus: 'MATCHED', status: 'MATCHED' });
    // прямой contract-источник, чтобы не требовать PR (упрощение)
    const pay = await createPaymentRequest(junior(), {
      sourceType: 'INVOICE',
      sourceId: invoice.id,
      requestedMinor: 100n,
      purposeNote: 'x',
      isPrepayment: false,
    });
    const { payment } = await submitPaymentRequest(junior(), pay.id);
    expect(control(payment, 'RELATED_PARTY')?.result).toBe('WARN');
    expect(control(payment, 'NEW_VENDOR')?.result).toBe('WARN');
    const cancelled = await cancelPaymentRequest(junior(), pay.id, 'не требуется');
    expect(cancelled.status).toBe('CANCELLED');
  });
});
