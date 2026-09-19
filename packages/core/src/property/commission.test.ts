import { describe, expect, it } from 'vitest';
import { assertKpiConfirmable, bonusLines, bonusSettingsFrom, computeCommission, deriveBonusStatus, kpiDeadline } from './commission.js';

describe('BR-P41 — комиссия ORDO по продукту', () => {
  it('аренда: 50% месяца c арендатора; продажа: 3% c продавца, коридор 1,5–3%; STR — ставка не утверждена', () => {
    expect(computeCommission('LEASE_LTR', 300_000n)).toMatchObject({ payer: 'TENANT', base: 'MONTH_RENT', rateBp: 5000, amountMinor: 150_000n });
    expect(computeCommission('LEASE_OFFICE', 1_000_000n).amountMinor).toBe(500_000n);
    expect(computeCommission('SALE', 35_000_000n)).toMatchObject({ payer: 'SELLER', rateBp: 300, amountMinor: 1_050_000n });
    expect(computeCommission('SALE', 35_000_000n, 200).amountMinor).toBe(700_000n);
    expect(() => computeCommission('SALE', 35_000_000n, 100)).toThrow(/OUT_OF_CORRIDOR/);
    expect(() => computeCommission('LEASE_LTR', 300_000n, 4000)).toThrow(/OUT_OF_CORRIDOR/);
    expect(() => computeCommission('STR_MANDATE', 300_000n)).toThrow(/COMMISSION_RATE_OPEN/);
    expect(() => computeCommission('LEASE_LTR', 0n)).toThrow(/COMMISSION_BASE_REQUIRED/);
  });
});

describe('BR-P43 — бонус продажника', () => {
  it('аренда: 20% + 10% KPI от чистой комиссии; продажа: треть комиссии (1% от суммы при 3%); STR — пусто; настройки тенанта', () => {
    expect(bonusLines('LEASE_LTR', 150_000n)).toEqual([{ kind: 'DEAL', rateBp: 2000, amountMinor: 30_000n }, { kind: 'KPI', rateBp: 1000, amountMinor: 15_000n }]);
    expect(bonusLines('SALE', 1_050_000n)).toEqual([{ kind: 'DEAL', rateBp: 3333, amountMinor: 349_965n }]); // ≈ 1% от 35 000 000
    expect(bonusLines('STR_MANDATE', 100n)).toEqual([]);
    expect(bonusLines('LEASE_LTR', 0n)).toEqual([]);
    const s = bonusSettingsFrom({ bonus_lease_deal_bp: 2500, bonus_kpi_deadline_days: 30 });
    expect(s).toMatchObject({ leaseDealBp: 2500, leaseKpiBp: 1000, kpiDeadlineDays: 30 });
    expect(kpiDeadline(new Date('2026-09-01T00:00:00Z'), s).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('KPI: не сам продажник, все пункты, в срок; статусы DEAL/KPI из статуса комиссии (BR-P44)', () => {
    const base = { doneItems: ['ONBOARDING', 'ACCESS_KEYS', 'INTERNET', 'CLEANING', 'HANDOVER_SERVICES'] as const, confirmerId: 'cm', salespersonId: 'sales', deadline: new Date('2026-09-15'), now: new Date('2026-09-10') };
    expect(() => assertKpiConfirmable(base)).not.toThrow();
    expect(() => assertKpiConfirmable({ ...base, confirmerId: 'sales' })).toThrow(/KPI_SELF_CONFIRM/);
    expect(() => assertKpiConfirmable({ ...base, doneItems: ['ONBOARDING'] })).toThrow(/KPI_INCOMPLETE/);
    expect(() => assertKpiConfirmable({ ...base, now: new Date('2026-09-16') })).toThrow(/KPI_DEADLINE_PASSED/);
    const d = (kind: 'DEAL' | 'KPI', commissionStatus: 'ACCRUED' | 'PARTIAL' | 'PAID' | 'CANCELLED', kpiConfirmed = false, kpiDeadlinePassed = false, current: 'POTENTIAL' | 'CONFIRMED' | 'PAYABLE' | 'PAID' | 'WITHHELD' = 'POTENTIAL') => deriveBonusStatus({ kind, current, commissionStatus, kpiConfirmed, kpiDeadlinePassed });
    expect(d('DEAL', 'ACCRUED')).toBe('CONFIRMED');
    expect(d('DEAL', 'PARTIAL')).toBe('CONFIRMED');
    expect(d('DEAL', 'PAID')).toBe('PAYABLE');
    expect(d('DEAL', 'CANCELLED')).toBe('WITHHELD');
    expect(d('KPI', 'PAID')).toBe('POTENTIAL');
    expect(d('KPI', 'PAID', true)).toBe('PAYABLE');
    expect(d('KPI', 'ACCRUED', true)).toBe('CONFIRMED');
    expect(d('KPI', 'ACCRUED', false, true)).toBe('WITHHELD');
    expect(d('DEAL', 'CANCELLED', false, false, 'PAID')).toBe('PAID'); // выплаченное не отзывается
  });
});
