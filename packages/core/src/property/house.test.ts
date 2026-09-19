import { describe, expect, it } from 'vitest';
import { annualRecalc, bottomUpTariff, budgetVsActual, collectionScenarios, houseContribution, houseDueAt, managementFeeLine } from './house.js';

describe('Деньги дома (BR-P51/P52/P54)', () => {
  it('BR-P51: взнос по кадастровой площади, иначе договорная c пометкой; срок до 15 числа', () => {
    expect(houseContribution(101.9, 100, 30_000_00n)).toEqual({ amountMinor: 3_000_000_00n, areaM2: 100, preCadastre: false });
    expect(houseContribution(101.9, null, 30_000_00n)).toMatchObject({ amountMinor: 3_057_000_00n, preCadastre: true });
    expect(() => houseContribution(0, null, 1n)).toThrow(/AREA_REQUIRED/);
    expect(houseDueAt(new Date('2026-09-01T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-15');
  });
  it('BR-P52: вознаграждение ORDO отдельной строкой и только при утверждённой ставке; сценарии собираемости; bottom-up тариф', () => {
    expect(managementFeeLine(10_000n, null)).toBeNull();
    expect(managementFeeLine(10_000n, 1000)).toBe(1_000n);
    expect(collectionScenarios(100_000n)).toEqual([{ pct: 70, collectedMinor: 70_000n }, { pct: 85, collectedMinor: 85_000n }, { pct: 95, collectedMinor: 95_000n }]);
    expect(bottomUpTariff(1_200_000_00n, 100)).toBe(100_000n); // 1 200 000 / 100 м² / 12 = 1 000.00
  });
  it('BR-P54: годовой перерасчёт — сверхпоступление кредит, недобор в следующий период; план/факт c compliance-floor', () => {
    expect(annualRecalc(1_000n, 900n, 800n)).toMatchObject({ balanceMinor: 100n, carryForwardCreditMinor: 100n, shortfallMinor: 0n, collectionPct: 90 });
    expect(annualRecalc(1_000n, 700n, 800n)).toMatchObject({ balanceMinor: -100n, carryForwardCreditMinor: 0n, shortfallMinor: 100n });
    const lines = budgetVsActual([{ category: 'LIFTS', plannedMinor: 500n }, { category: 'CLEANING', plannedMinor: 300n }], [{ category: 'LIFTS', amountMinor: 550n }, { category: 'OTHER', amountMinor: 10n }]);
    expect(lines.find((l) => l.category === 'LIFTS')).toMatchObject({ varianceMinor: 50n, complianceFloor: true });
    expect(lines.find((l) => l.category === 'OTHER')).toMatchObject({ plannedMinor: 0n, actualMinor: 10n, complianceFloor: false });
  });
});
