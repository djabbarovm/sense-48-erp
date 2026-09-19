import { describe, expect, it } from 'vitest';
import { outstandingOf, prorateRent, rentChargeStatus, rentDueAt, rentPeriods, validateReceipt } from './rent.js';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('BR-P38 — начисление аренды по месяцам c пропорцией по дням', () => {
  it('первый и последний месяц пропорционально, середина — целиком; месяцы после upTo не начисляются', () => {
    const periods = rentPeriods(300_000n, d('2026-01-16'), d('2026-03-10'), d('2026-06-01'));
    expect(periods.map((p) => [p.periodStart.toISOString().slice(0, 10), p.periodEnd.toISOString().slice(0, 10), p.amountMinor, p.prorated])).toEqual([
      ['2026-01-16', '2026-01-31', 154_838n, true], // 16/31
      ['2026-02-01', '2026-02-28', 300_000n, false],
      ['2026-03-01', '2026-03-10', 96_774n, true], // 10/31
    ]);
    expect(rentPeriods(300_000n, d('2026-05-01'), null, d('2026-06-15'))).toHaveLength(2); // май и июнь (бессрочный)
    expect(rentPeriods(300_000n, d('2026-09-01'), null, d('2026-06-15'))).toHaveLength(0); // ещё не начался
    expect(prorateRent(100n, d('2026-02-01'), d('2026-03-01'), null)).toBeNull();
    expect(rentDueAt(d('2026-02-01'), 5).toISOString()).toBe('2026-02-06T00:00:00.000Z');
  });
});

describe('BR-P37 — PAID только по полученной сумме', () => {
  it('статус из суммы и срока; остаток; зачёт не больше остатка', () => {
    const base = { amountMinor: 1000n, receivedMinor: 0n, dueAt: d('2026-09-06') };
    expect(rentChargeStatus(base, d('2026-09-05'))).toBe('DUE');
    expect(rentChargeStatus(base, d('2026-09-07'))).toBe('OVERDUE');
    expect(rentChargeStatus({ ...base, receivedMinor: 400n }, d('2026-09-05'))).toBe('PARTIAL');
    expect(rentChargeStatus({ ...base, receivedMinor: 400n }, d('2026-09-07'))).toBe('OVERDUE');
    expect(rentChargeStatus({ ...base, receivedMinor: 1000n }, d('2026-12-01'))).toBe('PAID');
    expect(rentChargeStatus({ ...base, status: 'WAIVED' }, d('2026-12-01'))).toBe('WAIVED');
    expect(outstandingOf({ amountMinor: 1000n, receivedMinor: 400n, status: 'PARTIAL' })).toBe(600n);
    expect(outstandingOf({ amountMinor: 1000n, receivedMinor: 0n, status: 'WAIVED' })).toBe(0n);
    expect(validateReceipt(600n, 600n)).toBe(600n);
    expect(() => validateReceipt(601n, 600n)).toThrow(/OVERPAYMENT/);
    expect(() => validateReceipt(0n, 600n)).toThrow(/AMOUNT_INVALID/);
  });
});
