import { describe, expect, it } from 'vitest';
import {
  addMoney,
  compareMoney,
  convertToBase,
  divRoundHalfUp,
  formatMoney,
  money,
  parseDecimalToMinor,
  splitGrossVat,
  subtractMoney,
} from './index.js';
import { ValidationError } from '../errors/index.js';

describe('A-08 Money (D-08/09/10)', () => {
  it('запрет float: дробный number отклоняется', () => {
    expect(() => money(12.5, 'UZS')).toThrow(ValidationError);
    expect(() => money(125, 'UZS')).not.toThrow();
    expect(money('1250000000', 'UZS').minor).toBe(1250000000n);
  });

  it('арифметика в одной валюте, mismatch отклоняется', () => {
    const a = money(1000n, 'UZS');
    const b = money(250n, 'UZS');
    expect(addMoney(a, b).minor).toBe(1250n);
    expect(subtractMoney(a, b).minor).toBe(750n);
    expect(compareMoney(a, b)).toBe(1);
    expect(() => addMoney(a, money(1n, 'USD'))).toThrow(/CURRENCY_MISMATCH|USD/);
  });

  it('divRoundHalfUp: округление к ближайшему, .5 вверх', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n); // 2.5 → 3
    expect(divRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(7n, 3n)).toBe(2n); // 2.33 → 2
  });

  it('FX: 100 USD по курсу 12800.5 → 128 005 000 тийин (D-08)', () => {
    const usd = money(10000n, 'USD'); // 100.00 USD в центах
    const uzs = convertToBase(usd, '12800.500000');
    expect(uzs.currency).toBe('UZS');
    expect(uzs.minor).toBe(128005000n); // 1 280 050 сум
    expect(formatMoney(uzs)).toBe('1 280 050 сум');
    // UZS в UZS — без изменений
    const same = convertToBase(money(100n, 'UZS'), '1');
    expect(same.minor).toBe(100n);
  });

  it('НДС 12%: gross 112 000 000 тийин → vat 12 000 000, net 100 000 000 (D-10)', () => {
    const { net, vat } = splitGrossVat(money(11200000000n, 'UZS'), 1200);
    expect(vat.minor).toBe(1200000000n);
    expect(net.minor).toBe(10000000000n);
    expect(net.minor + vat.minor).toBe(11200000000n); // всегда сходится с gross
  });

  it('parseDecimalToMinor: CSV-строки в тийины', () => {
    expect(parseDecimalToMinor('12500000.00')).toBe(1250000000n);
    expect(parseDecimalToMinor('12500000')).toBe(1250000000n);
    expect(parseDecimalToMinor('0.5')).toBe(50n);
    expect(parseDecimalToMinor('-15,25')).toBe(-1525n);
    expect(parseDecimalToMinor('12 500.10')).toBe(1250010n);
    expect(() => parseDecimalToMinor('12.345')).toThrow(/decimal places/);
    expect(() => parseDecimalToMinor('abc')).toThrow(/Cannot parse/);
  });

  it('formatMoney: `12 500 000 сум` (D-09), не-UZS с центами', () => {
    expect(formatMoney(money(1250000000n, 'UZS'))).toBe('12 500 000 сум');
    expect(formatMoney(money(-1250000000n, 'UZS'))).toBe('−12 500 000 сум');
    expect(formatMoney(money(125050n, 'USD'))).toBe('1 250.50 USD');
    expect(formatMoney(money(0n, 'UZS'))).toBe('0 сум');
  });
});
