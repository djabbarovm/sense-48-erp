import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { checkBudget, getBudgetStatus, upsertBudgetLine } from '../src/services/budgets.js';

let tenantId: string;
let ccId: string;
let catRequiredId: string;
let catOptionalId: string;
const lead = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['FINANCE_OPS_LEAD'] });

const PERIOD = '2026-09';

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-b04-${ts}`, legalName: 'B04', taxId: '300000014' } })
  ).id;
  ccId = (await prisma.costCenter.create({ data: { tenantId, code: 'CC', name: 'CC' } })).id;
  catRequiredId = (
    await prisma.category.create({
      data: { tenantId, code: 'REQ', name: 'req', group: 'FNB', budgetRequired: true },
    })
  ).id;
  catOptionalId = (
    await prisma.category.create({
      data: { tenantId, code: 'OPT', name: 'opt', group: 'OTHER', budgetRequired: false },
    })
  ).id;
});

afterAll(async () => prisma.$disconnect());

describe('B-04 Budget (BR-014)', () => {
  it('upsert плана + идемпотентное обновление', async () => {
    const row = await upsertBudgetLine(lead(), {
      period: PERIOD,
      costCenterId: ccId,
      categoryId: catRequiredId,
      plannedMinor: 10_000_000_00n,
    });
    expect(row.plannedMinor).toBe(10_000_000_00n);
    const updated = await upsertBudgetLine(lead(), {
      period: PERIOD,
      costCenterId: ccId,
      categoryId: catRequiredId,
      plannedMinor: 20_000_000_00n,
    });
    expect(updated.id).toBe(row.id);
    expect(updated.plannedMinor).toBe(20_000_000_00n);
  });

  it('BR-014: WITHIN при remaining >= total', async () => {
    expect(
      await checkBudget(lead(), { period: PERIOD, costCenterId: ccId, categoryId: catRequiredId, totalMinor: 20_000_000_00n }),
    ).toBe('WITHIN');
  });

  it('BR-014: committed из approved PR уменьшает remaining → OVER', async () => {
    const requester = crypto.randomUUID();
    await prisma.purchaseRequest.create({
      data: {
        tenantId,
        number: `PR-B04-${Date.now()}`,
        requesterId: requester,
        what: 'x',
        totalMinor: 15_000_000_00n,
        purpose: 'p',
        costCenterId: ccId,
        categoryId: catRequiredId,
        status: 'APPROVED',
      },
    });
    const status = await getBudgetStatus(lead(), PERIOD, ccId, catRequiredId);
    expect(status!.committedMinor).toBe(15_000_000_00n);
    expect(status!.remainingMinor).toBe(5_000_000_00n);
    expect(
      await checkBudget(lead(), { period: PERIOD, costCenterId: ccId, categoryId: catRequiredId, totalMinor: 6_000_000_00n }),
    ).toBe('OVER');
    expect(
      await checkBudget(lead(), { period: PERIOD, costCenterId: ccId, categoryId: catRequiredId, totalMinor: 5_000_000_00n }),
    ).toBe('WITHIN');
  });

  it('BR-014: нет строки бюджета — UNBUDGETED если required, WITHIN если нет', async () => {
    expect(
      await checkBudget(lead(), { period: '2026-10', costCenterId: ccId, categoryId: catRequiredId, totalMinor: 1n }),
    ).toBe('UNBUDGETED');
    expect(
      await checkBudget(lead(), { period: '2026-10', costCenterId: ccId, categoryId: catOptionalId, totalMinor: 1n }),
    ).toBe('WITHIN');
  });

  it('невалидный период отклоняется', async () => {
    await expect(
      upsertBudgetLine(lead(), { period: '2026-13', costCenterId: ccId, categoryId: catRequiredId, plannedMinor: 1n }),
    ).rejects.toThrow(/YYYY-MM/);
  });

  it('D-07: actual из PAID-платежей по paid_at; PR c платежом не считается дважды', async () => {
    // PR committed 3 млн (INVOICED) + платёж по нему PAID 3 млн → PR исключается, actual = 3 млн
    const pr = await prisma.purchaseRequest.create({
      data: {
        tenantId,
        number: 'PR-B04-D07',
        requesterId: crypto.randomUUID(),
        what: 'x',
        purpose: 'p',
        totalMinor: 3_000_000_00n,
        costCenterId: ccId,
        categoryId: catRequiredId,
        status: 'INVOICED',
        createdAt: new Date('2026-09-05'),
      },
    });
    const account = await prisma.bankAccount.create({
      data: { tenantId, bankName: 'TB', mfo: '00444', accountMasked: '****7777', accountEncrypted: 'enc' },
    });
    const tx = await prisma.bankTransaction.create({
      data: {
        tenantId,
        bankAccountId: account.id,
        externalId: 'B04-D07',
        bookingDate: new Date('2026-09-10'),
        valueDate: new Date('2026-09-10'),
        amountMinor: -3_000_000_00n,
        counterpartyName: 'V',
        matchStatus: 'AUTO_MATCHED',
      },
    });
    await prisma.paymentRequest.create({
      data: {
        tenantId,
        number: 'PAY-B04-D07',
        sourceType: 'PR',
        sourceId: pr.id,
        requestedMinor: 3_000_000_00n,
        purposeNote: 'x',
        costCenterId: ccId,
        categoryId: catRequiredId,
        status: 'PAID',
        bankTransactionId: tx.id,
        paidAt: new Date('2026-09-10'),
      },
    });
    const status = await getBudgetStatus(lead(), PERIOD, ccId, catRequiredId);
    expect(status!.actualMinor).toBe(3_000_000_00n);
    // PR исключён из committed (осталось 15 млн из предыдущего теста, без двойного счёта)
    expect(status!.committedMinor).toBe(15_000_000_00n);
    expect(status!.remainingMinor).toBe(2_000_000_00n); // 20 − 15 − 3
  });
});
