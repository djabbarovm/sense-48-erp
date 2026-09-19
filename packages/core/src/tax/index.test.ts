import { describe, expect, it } from 'vitest';
import { INPS_WITHIN_NDFL_BP, UZ_TAX_PRESETS, splitInps, taxEstimate, taxPreset } from './index.js';
import { ValidationError } from '../errors/index.js';

describe('Налоговый профиль', () => {
  it('пресет UZ_TURNOVER_4: три обязательства до 15 числа, ИНПС внутри НДФЛ', () => {
    const p = taxPreset('UZ_TURNOVER_4');
    expect(p.rules.map((r) => [r.type, r.rateBp, r.baseKind, r.dueDay])).toEqual([['OTHER', 400, 'TURNOVER', 15], ['SOCIAL', 1200, 'PAYROLL', 15], ['PAYROLL_TAX', 1200, 'PAYROLL', 15]]);
    expect(p.rules.some((r) => /ИНПС/.test(r.note ?? ''))).toBe(true);
    expect(INPS_WITHIN_NDFL_BP).toBe(10);
    expect(() => taxPreset('NOPE')).toThrow(ValidationError);
    expect(UZ_TAX_PRESETS.length).toBeGreaterThan(0);
  });
  it('оценка: 4% от 100 000 000 = 4 000 000; ставка вне 0–100% — ошибка', () => {
    expect(taxEstimate(100_000_000_00n, 400)).toBe(4_000_000_00n);
    expect(taxEstimate(0n, 1200)).toBe(0n);
    expect(() => taxEstimate(1n, 10_001)).toThrow(ValidationError);
  });
  it('ИНПС 0,1% от ФОТ выделяется из НДФЛ, а не добавляется', () => {
    const gross = 50_000_000_00n; const ndfl = taxEstimate(gross, 1200);
    expect(splitInps(ndfl, gross)).toEqual({ inpsMinor: 50_000_00n, ndflNetMinor: ndfl - 50_000_00n });
  });
});
