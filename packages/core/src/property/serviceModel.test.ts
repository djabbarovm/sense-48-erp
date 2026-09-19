import { describe, expect, it } from 'vitest';
import { applyClientDiscount, costToServe, nextPackageRun, parsePartnerStatementCsv, referralFee, serviceRevenueSplit3 } from './service.js';

describe('BR-P47 — трёхуровневый учёт услуг (GMV → Services → исполнитель)', () => {
  it('партнёр: Services = комиссия, партнёру остаток; своя эксплуатация: внутренняя ставка OPEN → Services 0, всё Operations', () => {
    expect(serviceRevenueSplit3(100_000n, 'PARTNER', 1500, null)).toEqual({ gmvMinor: 100_000n, servicesRevenueMinor: 15_000n, executorRevenueMinor: 85_000n, executor: 'PARTNER' });
    expect(serviceRevenueSplit3(100_000n, 'OWN_OPS', 1500, null)).toEqual({ gmvMinor: 100_000n, servicesRevenueMinor: 0n, executorRevenueMinor: 100_000n, executor: 'OPERATIONS' });
    expect(serviceRevenueSplit3(100_000n, 'OWN_OPS', 0, 1000).servicesRevenueMinor).toBe(10_000n);
    expect(applyClientDiscount(100_000n, 500)).toBe(95_000n); // скидка — выгода клиента
    expect(() => applyClientDiscount(1n, 20_000)).toThrow(/DISCOUNT_INVALID/);
  });
  it('cost-to-serve, пакеты, referral и CSV партнёра', () => {
    expect(costToServe(30, 60_000n)).toBe(30_000n);
    expect(nextPackageRun(new Date('2026-09-01T00:00:00Z'), 8).toISOString().slice(0, 10)).toBe('2026-09-05'); // ~2 раза в неделю → каждые 4 дня
    expect(nextPackageRun(new Date('2026-09-01T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(() => nextPackageRun(new Date(), 0)).toThrow(/CADENCE_INVALID/);
    expect(referralFee(1_200_000n, 1500)).toBe(180_000n);
    expect(parsePartnerStatementCsv('customer;base;fee\n1004;120 000,00;15\n1208;80000\n')).toEqual([{ customerRef: '1004', baseMinor: 12_000_000n, feeBp: 1500 }, { customerRef: '1208', baseMinor: 8_000_000n, feeBp: null }]);
    expect(() => parsePartnerStatementCsv('x;abc')).toThrow(/STATEMENT_ROW_INVALID/);
  });
});
