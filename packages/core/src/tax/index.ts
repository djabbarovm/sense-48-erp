/**
 * Налоговый профиль (docs/02 §6, ответы бухгалтерии 19.09.2026): ставка и база правила календаря,
 * оценка ожидаемой суммы обязательства, пресеты режимов Узбекистана.
 * ИНПС 0,1% удерживается ИЗ НДФЛ (не сверх него) — отдельного обязательства нет, только пометка в правиле.
 */
import { ValidationError } from '../errors/index.js';

export const TAX_BASES = ['TURNOVER', 'PAYROLL'] as const;
export type TaxBase = (typeof TAX_BASES)[number];

export type TaxRuleType = 'VAT' | 'PROFIT' | 'PAYROLL_TAX' | 'SOCIAL' | 'PROPERTY' | 'OTHER';

export interface TaxPresetRule { type: TaxRuleType; name: string; rateBp: number; baseKind: TaxBase; dueDay: number; note?: string }
export interface TaxPreset { key: string; title: string; rules: TaxPresetRule[] }

export const INPS_WITHIN_NDFL_BP = 10; // 0,1 %

/** Пресеты режимов; ставки — на дату фиксации, меняются только правкой правила (audit). */
export const UZ_TAX_PRESETS: readonly TaxPreset[] = [
  {
    key: 'UZ_TURNOVER_4',
    title: 'Налог c оборота 4% + зарплатные налоги (ЕСП 12%, НДФЛ 12%, ИНПС 0,1% внутри НДФЛ), всё до 15 числа',
    rules: [
      { type: 'OTHER', name: 'Налог c оборота', rateBp: 400, baseKind: 'TURNOVER', dueDay: 15 },
      { type: 'SOCIAL', name: 'ЕСП (единый социальный платёж)', rateBp: 1200, baseKind: 'PAYROLL', dueDay: 15 },
      { type: 'PAYROLL_TAX', name: 'НДФЛ', rateBp: 1200, baseKind: 'PAYROLL', dueDay: 15, note: 'ИНПС 0,1% удерживается из НДФЛ, отдельно не платится' },
    ],
  },
];

export function taxPreset(key: string): TaxPreset {
  const p = UZ_TAX_PRESETS.find((x) => x.key === key);
  if (!p) throw new ValidationError('TAX_PRESET_UNKNOWN', `Unknown tax preset: ${key}`);
  return p;
}

/** Оценка суммы налога по базе и ставке (в тийинах, округление вниз). */
export function taxEstimate(baseMinor: bigint, rateBp: number): bigint {
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10_000) throw new ValidationError('RATE_INVALID', 'Ставка 0–100%');
  if (baseMinor < 0n) throw new ValidationError('BASE_INVALID');
  return (baseMinor * BigInt(rateBp)) / 10_000n;
}

/** Разбивка НДФЛ на ИНПС и остальное — для пояснения в платёжке (ИНПС внутри ставки НДФЛ). */
export function splitInps(ndflMinor: bigint, grossMinor: bigint): { inpsMinor: bigint; ndflNetMinor: bigint } {
  const inps = taxEstimate(grossMinor, INPS_WITHIN_NDFL_BP);
  return { inpsMinor: inps > ndflMinor ? ndflMinor : inps, ndflNetMinor: ndflMinor - (inps > ndflMinor ? ndflMinor : inps) };
}
