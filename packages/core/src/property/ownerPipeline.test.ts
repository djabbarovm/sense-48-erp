import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import { assertOwnerStageMove, canMoveOwnerStage, ownerConversion, ownerScenarios, ownerSegment } from './ownerPipeline.js';

describe('Воронка собственников (BR-P57/P58)', () => {
  it('переходы: вперёд на любую, назад на шаг, LOST не из HANDED_OVER, reopen только в CONTACTED', () => {
    expect(canMoveOwnerStage('LEAD', 'CONSENT')).toBe(true);
    expect(canMoveOwnerStage('CONSENT', 'CALC_SHOWN')).toBe(true);
    expect(canMoveOwnerStage('CONSENT', 'LEAD')).toBe(false);
    expect(canMoveOwnerStage('HANDED_OVER', 'LOST')).toBe(false);
    expect(canMoveOwnerStage('LOST', 'CONTACTED')).toBe(true);
    expect(canMoveOwnerStage('LOST', 'SIGNED')).toBe(false);
    expect(() => assertOwnerStageMove('SIGNED', 'SIGNED')).toThrow(ValidationError);
  });
  it('сегмент по помещениям', () => {
    expect(ownerSegment([{ type: 'APARTMENT', areaM2: 40 }])).toBe('STUDIO');
    expect(ownerSegment([{ type: 'APARTMENT', areaM2: 85 }, { type: 'APARTMENT', areaM2: 90 }])).toBe('TWO_BED');
    expect(ownerSegment([{ type: 'OFFICE', areaM2: 85 }, { type: 'APARTMENT', areaM2: 40 }])).toBe('MIXED');
    expect(ownerSegment([])).toBe('NONE');
  });
  it('три сценария: LTR без комиссии собственника, STR c opex и ставкой; OPEN-ставка → provisional при рекомендации STR', () => {
    const c = ownerScenarios({ ltrMonthlyMinor: 1_200_00n }); // $1 200/мес
    const [ltr, mid, str] = c.scenarios;
    expect(ltr!.ownerNetAnnualMinor).toBe(13_200_00n); // 11 мес
    expect(ltr!.ordoFeeAnnualMinor).toBe(0n);
    expect(mid!.grossAnnualMinor).toBe(15_750_00n); // 1500 × 10.5
    expect(str!.grossAnnualMinor).toBe(18_980_00n); // ADR 80 × 365 × 65%
    expect(str!.opexAnnualMinor).toBe(3_796_00n);
    expect(str!.ordoFeeAnnualMinor).toBe(3_796_00n); // 20% иллюстративно
    expect([c.recommended, c.provisional, str!.feeOpen]).toEqual(['MID', false, true]);
    const fixed = ownerScenarios({ ltrMonthlyMinor: 1_200_00n, strFeeBp: 1500, strAdrMinor: 120_00n, strOccupancyPct: 70 });
    expect([fixed.recommended, fixed.provisional, fixed.scenarios[2]!.feeOpen]).toEqual(['STR', false, false]);
    expect(() => ownerScenarios({ ltrMonthlyMinor: 0n })).toThrow(ValidationError);
  });
  it('конверсия по сегментам до SIGNED', () => {
    const r = ownerConversion([{ stage: 'SIGNED', segment: 'ONE_BED' }, { stage: 'LEAD', segment: 'ONE_BED' }, { stage: 'HANDED_OVER', segment: 'OFFICE' }, { stage: 'LOST', segment: 'OFFICE' }]);
    expect(r.find((x) => x.segment === 'ALL')).toMatchObject({ total: 4, reached: 2, lost: 1, pct: 50 });
    expect(r.find((x) => x.segment === 'ONE_BED')?.pct).toBe(50);
  });
});
