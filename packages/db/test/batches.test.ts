import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SodViolationError, encryptSecret, unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import {
  addToBatch,
  approveBatch,
  createBatch,
  exportBatch,
  freezeBatch,
  markBatchSent,
  removeFromBatch,
  reviewBatch,
  unfreezeBatch,
  type BatchSummary,
} from '../src/services/batches.js';
import { createPaymentRequest, submitPaymentRequest } from '../src/services/payments.js';

process.env.BANK_DATA_KEY ??= randomBytes(32).toString('base64');
const KEY = process.env.BANK_DATA_KEY!;

let tenantId: string;
let bankAccountId: string;
let vendorId: string;
const juniorId = crypto.randomUUID();
const junior2Id = crypto.randomUUID();
const leadId = crypto.randomUUID();
const ownerId = crypto.randomUUID();

const mk = (userId: string, ...roles: Parameters<typeof unsafeCreateTenantContext>[0]['roles']) =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId, roles });
const junior = () => mk(juniorId, 'JUNIOR_FINANCE');
const junior2 = () => mk(junior2Id, 'JUNIOR_FINANCE');
const lead = () => mk(leadId, 'FINANCE_OPS_LEAD');
const owner = () => mk(ownerId, 'OWNER');

async function readyPayment(actor = junior(), amount = 100_000_000n, urgent = false) {
  const invoice = await prisma.invoice.create({
    data: {
      tenantId,
      vendorId,
      number: `B-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: new Date(),
      type: 'SF',
      amountGrossMinor: amount,
      vatMinor: 0n,
      amountNetMinor: amount,
      status: 'MATCHED',
      matchStatus: 'MATCHED',
      prId: (
        await (async () => {
          const cc = await prisma.costCenter.findFirstOrThrow({ where: { tenantId } });
          const cat = await prisma.category.findFirstOrThrow({ where: { tenantId } });
          const pr = await prisma.purchaseRequest.create({
            data: {
              tenantId,
              number: `PR-BT-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              requesterId: crypto.randomUUID(),
              what: 'x',
              purpose: 'p',
              totalMinor: amount,
              costCenterId: cc.id,
              categoryId: cat.id,
              vendorId,
              status: 'INVOICED',
              tier: 1,
            },
          });
          await prisma.receipt.create({
            data: { tenantId, prId: pr.id, receiverId: crypto.randomUUID(), status: 'FULL' },
          });
          return pr;
        })()
      ).id,
    },
  });
  const pay = await createPaymentRequest(actor, {
    sourceType: 'INVOICE',
    sourceId: invoice.id,
    requestedMinor: amount,
    purposeNote: 'Оплата по СФ',
    ...(urgent ? { isUrgent: true, urgencyReason: 'SUPPLIER_STOP' as const } : {}),
  });
  const { payment } = await submitPaymentRequest(actor, pay.id);
  expect(payment.status).toBe('READY_FOR_BATCH');
  return payment;
}

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-c04-${ts}`, legalName: 'C04', taxId: '300000023' } })
  ).id;
  await prisma.costCenter.create({ data: { tenantId, code: 'CC', name: 'CC' } });
  await prisma.category.create({ data: { tenantId, code: 'CAT', name: 'Cat', group: 'OTHER' } });
  bankAccountId = (
    await prisma.bankAccount.create({
      data: {
        tenantId,
        bankName: 'Trustbank',
        mfo: '00491',
        accountMasked: '****7001',
        accountEncrypted: encryptSecret('20208000007312017001', KEY),
        openingBalanceMinor: 10_000_000_000n, // 100 млн сум
      },
    })
  ).id;
  vendorId = (
    await prisma.vendor.create({
      data: { tenantId, taxId: '311110020', legalName: 'BatchVendor', displayName: 'BatchVendor', status: 'ACTIVE' },
    })
  ).id;
  await prisma.vendorBankAccount.create({
    data: {
      tenantId,
      vendorId,
      bankName: 'TB',
      mfo: '00444',
      accountMasked: '****9001',
      accountEncrypted: encryptSecret('20208000900000009001', KEY),
      status: 'VERIFIED',
      isDefault: true,
      verifiedAt: new Date('2026-08-01'),
    },
  });
});

afterAll(async () => prisma.$disconnect());

describe('C-04/C-08 PaymentBatch', () => {
  it('полный цикл: create → add → freeze(summary) → review(4-eyes) → approve → export(CSV+sha) → sent (AC-06/08 путь)', async () => {
    const batch = await createBatch(junior(), { bankAccountId, batchDate: new Date('2026-09-14') });
    expect(batch.number).toBe('BATCH-2026-09-14');

    const p1 = await readyPayment(junior(), 200_000_000n);
    const p2 = await readyPayment(junior(), 300_000_000n);
    await addToBatch(junior(), batch.id, p1.id);
    await addToBatch(junior(), batch.id, p2.id);

    // BR-051: второй STANDARD batch в тот же день → ошибка
    await expect(createBatch(junior(), { bankAccountId, batchDate: new Date('2026-09-14') })).rejects.toThrow(/BR-051/);

    // freeze юниором → summary
    const frozen = await freezeBatch(junior(), batch.id);
    const summary = frozen.summary as unknown as BatchSummary;
    expect(summary.count).toBe(2);
    expect(summary.totalMinor).toBe('500000000');
    expect(summary.byUrgency).toEqual({ standard: 2, urgent: 0 });
    expect(BigInt(summary.cashAfterMinor)).toBe(10_000_000_000n - 500_000_000n); // BR-053
    expect(summary.cashWarning).toBe(false);

    // BR-052: изменить состав FROZEN нельзя
    await expect(removeFromBatch(junior(), p1.id)).rejects.toThrow(/BR-052|FROZEN/);

    // 4-eyes: тот же junior не может review (и права нет), lead может; freeze-автор не ревьюит
    await expect(reviewBatch(junior(), batch.id)).rejects.toThrow();
    const reviewed = await reviewBatch(lead(), batch.id);
    expect(reviewed.status).toBe('REVIEWED');

    // BR-057: экспорт до approve запрещён
    await expect(exportBatch(lead(), batch.id)).rejects.toThrow();

    const approved = await approveBatch(owner(), batch.id);
    expect(approved.status).toBe('APPROVED');

    const { batch: exported, csv, sha256 } = await exportBatch(lead(), batch.id);
    expect(exported.status).toBe('EXPORTED');
    const text = csv.toString('utf8');
    expect(text).toContain('payment_request_number;vendor_legal_name');
    expect(text).toContain('20208000900000009001'); // полный счёт — только в экспорте
    expect(sha256).toHaveLength(64);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: exported.exportFileDocumentId! } });
    expect(doc.sha256).toBe(sha256);

    const sent = await markBatchSent(junior(), batch.id);
    expect(sent.status).toBe('SENT');
    expect(
      await prisma.paymentRequest.count({ where: { batchId: batch.id, status: 'SENT_TO_BANK' } }),
    ).toBe(2);
  });

  it('BR-040/AC-15: item, подготовленный утверждающим, → SOD_VIOLATION; owner проходит', async () => {
    // lead готовит платёж сам
    const p = await readyPayment(lead(), 150_000_000n);
    const batch = await createBatch(junior(), { bankAccountId, batchDate: new Date('2026-09-15') });
    await addToBatch(junior(), batch.id, p.id);
    await freezeBatch(junior(), batch.id);
    await reviewBatch(junior2(), batch.id).catch(() => reviewBatch(lead(), batch.id));
    // lead (делегирован policy) утверждает свой же платёж → 403 SOD
    await expect(approveBatch(lead(), batch.id)).rejects.toThrow(SodViolationError);
    const ok = await approveBatch(owner(), batch.id);
    expect(ok.status).toBe('APPROVED');
  });

  it('AC-07: частичное утверждение — rejected item выходит из батча, PARTIALLY_APPROVED; reject без комментария → ошибка', async () => {
    const p1 = await readyPayment(junior(), 110_000_000n);
    const p2 = await readyPayment(junior(), 120_000_000n);
    const batch = await createBatch(junior(), { bankAccountId, batchDate: new Date('2026-09-16') });
    await addToBatch(junior(), batch.id, p1.id);
    await addToBatch(junior(), batch.id, p2.id);
    await freezeBatch(junior(), batch.id);
    await reviewBatch(lead(), batch.id);
    await expect(
      approveBatch(owner(), batch.id, [{ paymentId: p2.id, comment: '' }]),
    ).rejects.toThrow(/комментар/i);
    const partial = await approveBatch(owner(), batch.id, [{ paymentId: p2.id, comment: 'Отложить до сверки' }]);
    expect(partial.status).toBe('PARTIALLY_APPROVED');
    const rejected = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: p2.id } });
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.batchId).toBeNull();
    expect((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: p1.id } })).status).toBe('APPROVED');
  });

  it('unfreeze [LEAD] до review; пустой batch не freeze', async () => {
    const batch = await createBatch(junior(), { bankAccountId, batchDate: new Date('2026-09-17') });
    await expect(freezeBatch(junior(), batch.id)).rejects.toThrow(/items > 0/);
    const p = await readyPayment(junior(), 90_000_000n);
    await addToBatch(junior(), batch.id, p.id);
    await freezeBatch(junior(), batch.id);
    await expect(unfreezeBatch(junior(), batch.id)).rejects.toThrow(); // нет права batch.unfreeze
    const open = await unfreezeBatch(lead(), batch.id);
    expect(open.status).toBe('OPEN');
    await removeFromBatch(junior(), p.id); // теперь можно
  });

  it('C-08/BR-043: URGENT batch — только urgent-платежи, junior не может добавить, lead добавляет c ITEM-approval + Task', async () => {
    const urgentPay = await readyPayment(junior(), 80_000_000n, true);
    const normalPay = await readyPayment(junior(), 70_000_000n);
    const urgentBatch = await createBatch(lead(), { bankAccountId, batchDate: new Date('2026-09-14'), type: 'URGENT' });
    expect(urgentBatch.number).toBe('BATCH-2026-09-14-U1');
    await expect(addToBatch(lead(), urgentBatch.id, normalPay.id)).rejects.toThrow(/только urgent/);
    await expect(addToBatch(junior(), urgentBatch.id, urgentPay.id)).rejects.toThrow(/Owner\/Lead \(BR-043\)/);
    await addToBatch(lead(), urgentBatch.id, urgentPay.id);
    expect(
      await prisma.batchApproval.count({
        where: { batchId: urgentBatch.id, scope: 'ITEM', paymentRequestId: urgentPay.id, decision: 'APPROVED' },
      }),
    ).toBe(1);
    expect(
      await prisma.task.count({
        where: { tenantId, objectType: 'payment_request', objectId: urgentPay.id, type: 'REVIEW_EXCEPTION', status: 'OPEN' },
      }),
    ).toBe(1);
    // второй URGENT в тот же день допускается
    const u2 = await createBatch(lead(), { bankAccountId, batchDate: new Date('2026-09-14'), type: 'URGENT' });
    expect(u2.number).toBe('BATCH-2026-09-14-U2');
  });
});
