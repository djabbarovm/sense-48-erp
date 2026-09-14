import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import {
  getCashForecast,
  snapshotForecast,
  upsertCashPlanLine,
  weekStartOf,
} from '../src/services/forecast.js';
import { createCustomerInvoice, issueCustomerInvoice, promiseToPay } from '../src/services/arInvoices.js';

let tenantId: string;
let customerId: string;

const ctx = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['FINANCE_OPS_LEAD'] });

// понедельник
const NOW = new Date('2026-09-14T10:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86400_000);

describe('D-04 13-week cash forecast', () => {
  beforeAll(async () => {
    const ts = Date.now();
    tenantId = (await prisma.tenant.create({ data: { slug: `t-d04-${ts}`, legalName: 'D04', taxId: '300000066' } })).id;
    customerId = (await prisma.customer.create({ data: { tenantId, legalName: 'FC Client', paymentTermsDays: 0 } })).id;
    await prisma.bankAccount.create({
      data: {
        tenantId,
        bankName: 'TB',
        mfo: '00444',
        accountMasked: '****3333',
        accountEncrypted: 'enc',
        openingBalanceMinor: 100_000_000_00n, // 100 млн
      },
    });
  });
  afterAll(async () => prisma.$disconnect());

  it('weekStartOf: понедельник недели', () => {
    expect(weekStartOf(new Date('2026-09-14T10:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-14');
    expect(weekStartOf(new Date('2026-09-20T23:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-14');
    expect(weekStartOf(new Date('2026-09-21T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-21');
  });

  it('opening + AR (promise важнее due) + платежи + план MONTHLY → weekly net/closing', async () => {
    // AR 20 млн: due на этой неделе, promise на 3-й неделе → попадает в неделю 2 (index)
    const cinv = await createCustomerInvoice(ctx(), { customerId, date: NOW, dueDate: days(2), amountGrossMinor: 20_000_000_00n });
    await issueCustomerInvoice(ctx(), cinv.id);
    await promiseToPay(ctx(), cinv.id, days(15));
    // платёж 30 млн due на следующей неделе
    const contract = await prisma.contract.create({
      data: { tenantId, number: 'CTR-D04', counterpartyType: 'CUSTOMER', customerId, subject: 'x', startDate: NOW, status: 'ACTIVE' },
    });
    await prisma.paymentRequest.create({
      data: {
        tenantId,
        number: 'PAY-D04-1',
        sourceType: 'CONTRACT',
        sourceId: contract.id,
        requestedMinor: 30_000_000_00n,
        purposeNote: 'x',
        status: 'READY_FOR_BATCH',
        dueDate: days(8),
      },
    });
    // loan 15 млн ежемесячно c 20 сентября
    await upsertCashPlanLine(ctx(), {
      name: 'Погашение кредита',
      type: 'LOAN_REPAYMENT',
      amountMinor: -15_000_000_00n,
      dueDate: new Date('2026-09-20'),
      recurrence: 'MONTHLY',
    });

    const forecast = await getCashForecast(ctx(), NOW);
    expect(forecast.openingMinor).toBe(100_000_000_00n);
    expect(forecast.weeks).toHaveLength(13);
    const [w0, w1, w2] = forecast.weeks;
    expect(w0!.outflowPlanMinor).toBe(15_000_000_00n); // 20.09 — эта неделя
    expect(w0!.closingMinor).toBe(85_000_000_00n);
    expect(w1!.outflowPaymentsMinor).toBe(30_000_000_00n);
    expect(w1!.closingMinor).toBe(55_000_000_00n);
    expect(w2!.inflowArMinor).toBe(20_000_000_00n); // promise 29.09
    expect(w2!.closingMinor).toBe(75_000_000_00n);
    // ежемесячный кредит встречается ~3 раза за 13 недель
    const loanWeeks = forecast.weeks.filter((w) => w.outflowPlanMinor > 0n).length;
    expect(loanWeeks).toBeGreaterThanOrEqual(3);
  });

  it('snapshot идемпотентен: прогноз недели фиксируется один раз', async () => {
    await snapshotForecast(tenantId, NOW);
    const snap1 = await prisma.cashForecastSnapshot.findFirst({ where: { tenantId } });
    expect(snap1).not.toBeNull();
    // повторный запуск не меняет прогноз
    await prisma.paymentRequest.create({
      data: {
        tenantId,
        number: 'PAY-D04-2',
        sourceType: 'CONTRACT',
        sourceId: (await prisma.contract.findFirstOrThrow({ where: { tenantId } })).id,
        requestedMinor: 99_000_000_00n,
        purposeNote: 'x',
        status: 'READY_FOR_BATCH',
        dueDate: days(1),
      },
    });
    await snapshotForecast(tenantId, NOW);
    const snap2 = await prisma.cashForecastSnapshot.findFirst({ where: { tenantId } });
    expect(snap2!.forecastMinor).toBe(snap1!.forecastMinor);
  });
});
