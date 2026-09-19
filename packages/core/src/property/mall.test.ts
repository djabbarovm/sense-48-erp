import { describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext } from '../context/index.js';
import { assetManagementFee, mallKpi, mandateMachine, ownerEconomics, potentialRentByScenario, tenantMix, type MallUnitInput } from './mall.js';

const u = (p: Partial<MallUnitInput> & { id: string }): MallUnitInput => ({ floorNo: 1, areaM2: 100, isCommercial: true, readiness: 'READY', occupied: false, monthlyRentMinor: null, askingRateMinor: null, tenantCategory: null, mandateStatus: null, vacantDays: null, leaseEndsInDays: null, ...p });
const units = [
  u({ id: 'a', occupied: true, monthlyRentMinor: 400_000n, tenantCategory: 'FASHION', mandateStatus: 'ACTIVE' }),
  u({ id: 'b', areaM2: 50, occupied: true, monthlyRentMinor: 250_000n, tenantCategory: 'FOOD_BEVERAGE', mandateStatus: 'SIGNED', leaseEndsInDays: 30 }),
  u({ id: 'c', areaM2: 150, vacantDays: 200, mandateStatus: 'ACTIVE' }),
  u({ id: 'd', areaM2: 100, readiness: 'FITOUT' }),
  u({ id: 'e', areaM2: 30, isCommercial: false }),
];

describe('ORDO Mall — агрегаты и мандаты (BR-P45/P46)', () => {
  it('KPI по GLA: сдано, вакантно, ремонт; контролируемая база только по ACTIVE мандатам; tenant mix по доле GLA', () => {
    const k = mallKpi(units);
    expect(k).toMatchObject({ glaM2: 400, leasedGlaM2: 150, vacantGlaM2: 150, renovationGlaM2: 100, occupancyByGlaPct: 37.5, units: 4, leasedUnits: 2, currentRentMinor: 650_000n, expiring90: 1, mandateActive: 2, mandateSigned: 1, mandateCoverageGlaPct: 62.5, controlledLeasedGlaM2: 100, controlledRentMinor: 400_000n, avgVacantDays: 200 });
    expect(tenantMix(units).map((l) => [l.category, l.sharePct])).toEqual([['FASHION', 66.7], ['FOOD_BEVERAGE', 33.3]]);
    expect(potentialRentByScenario(units, { '1': { conservative: 3_000n, base: 4_000n, optimistic: 5_000n } }, { conservative: 1n, base: 1n, optimistic: 1n })).toEqual({ conservative: 1_200_000n, base: 1_600_000n, optimistic: 2_000_000n });
    expect(assetManagementFee(1_000_000n, null)).toBeNull(); // ставка не утверждена → не считаем
    expect(assetManagementFee(1_000_000n, 600)).toBe(60_000n);
  });

  it('мандат: sign требует собственника, activate — единственный на помещение, terminate — причину', () => {
    const cm = unsafeCreateTenantContext({ tenantId: 't', tenantSlug: 't', userId: 'u', roles: ['COMMERCIAL_MANAGER'] });
    expect(() => mandateMachine.assert(cm, 'DRAFT', 'sign', { hasOwner: false, otherActiveOnUnit: false })).toThrow(/MANDATE_OWNER_REQUIRED/);
    expect(mandateMachine.assert(cm, 'DRAFT', 'sign', { hasOwner: true, otherActiveOnUnit: false })).toBe('SIGNED');
    expect(() => mandateMachine.assert(cm, 'SIGNED', 'activate', { hasOwner: true, otherActiveOnUnit: true })).toThrow(/MANDATE_ALREADY_ACTIVE/);
    expect(mandateMachine.assert(cm, 'SIGNED', 'activate', { hasOwner: true, otherActiveOnUnit: false })).toBe('ACTIVE');
    expect(() => mandateMachine.assert(cm, 'ACTIVE', 'terminate', { hasOwner: true, otherActiveOnUnit: false })).toThrow(/REASON_REQUIRED/);
    expect(mandateMachine.availableTriggers(unsafeCreateTenantContext({ tenantId: 't', tenantSlug: 't', userId: 'u', roles: ['BROKER'] }), 'DRAFT', { hasOwner: true, otherActiveOnUnit: false })).toEqual([]);
  });

  it('экономика собственника 5 лет: без ORDO — простой и брокерские; c ORDO — льготы и вознаграждение; без ставки — delta null', () => {
    const base = { areaM2: 100, rateMinor: 4_000n, indexationPct: 10, indexationPctWithout: 0, vacancyDaysWithout: 180, vacancyDaysWith: 45, tenantChangesWithout: 2, brokerFeeMonths: 1, fitoutFreeMonths: 3, discountedMonths: 9, discountPct: 30, feeBp: 600, successFeeMonths: 0.5, ordoDeals: 1 };
    const e = ownerEconomics(base);
    expect(e.without.grossMinor).toBe(24_000_000n); // $40×100×12×5 = $240 000
    expect(e.without.brokerMinor).toBe(800_000n);
    expect(e.with.grossMinor).toBeGreaterThan(e.without.grossMinor); // индексация 10%
    expect(e.with.concessionsMinor).toBe(1_200_000n + 1_080_000n);
    expect(e.with.feeMinor).not.toBeNull();
    expect(e.deltaMinor).not.toBeNull();
    expect(ownerEconomics({ ...base, feeBp: null }).deltaMinor).toBeNull();
  });
});
