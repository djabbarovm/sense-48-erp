/**
 * D-08/09: деньги — только целые minor units (тийины/центы) в bigint.
 * Float в денежных расчётах запрещён: любые дробные number отклоняются.
 */
import { ValidationError } from '../errors/index.js';

export interface Money {
  readonly minor: bigint;
  readonly currency: string; // ISO 4217
}

export function money(minor: bigint | number | string, currency: string): Money {
  if (typeof minor === 'number' && !Number.isSafeInteger(minor)) {
    throw new ValidationError('MONEY_FLOAT_FORBIDDEN', 'Money accepts only integer minor units');
  }
  return { minor: BigInt(minor), currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new ValidationError('CURRENCY_MISMATCH', `${a.currency} vs ${b.currency}`);
  }
}

export const addMoney = (a: Money, b: Money): Money => {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
};

export const subtractMoney = (a: Money, b: Money): Money => {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
};

export const compareMoney = (a: Money, b: Money): -1 | 0 | 1 => {
  assertSameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
};

export const isZero = (a: Money): boolean => a.minor === 0n;
export const isNegative = (a: Money): boolean => a.minor < 0n;

/** Округление half-up при делении bigint (используется в FX и НДС). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new ValidationError('DIV_BY_NON_POSITIVE');
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator < 0n ? -numerator : numerator;
  return (sign * (2n * abs + denominator)) / (2n * denominator);
}

const FX_SCALE = 1_000_000n; // numeric(18,6)

/**
 * D-08: конвертация в базовую валюту по курсу на дату документа.
 * rate — строка вида "12800.123456" (rate_to_uzs, 6 знаков), деньги в центах → тийины.
 * UZS→UZS возвращает вход.
 */
export function convertToBase(amount: Money, rateToBase: string, baseCurrency = 'UZS'): Money {
  if (amount.currency === baseCurrency) return amount;
  const rateScaled = parseDecimalScaled(rateToBase, 6);
  // amount.minor (центы) * rate → тийины: обе валюты имеют 2 minor-знака, масштаб сокращается
  return { minor: divRoundHalfUp(amount.minor * rateScaled, FX_SCALE), currency: baseCurrency };
}

/** D-10: разбивка gross на net+vat по ставке в базисных пунктах (1200 = 12%): vat = gross*bp/(10000+bp). */
export function splitGrossVat(gross: Money, vatRateBp: number): { net: Money; vat: Money } {
  if (!Number.isInteger(vatRateBp) || vatRateBp < 0) throw new ValidationError('VAT_RATE_INVALID');
  const bp = BigInt(vatRateBp);
  const vatMinor = divRoundHalfUp(gross.minor * bp, 10000n + bp);
  return {
    vat: { minor: vatMinor, currency: gross.currency },
    net: { minor: gross.minor - vatMinor, currency: gross.currency },
  };
}

/** Импорт из CSV: "12500000.00" → 1250000000n (minor). Запятая как десятичный разделитель допустима. */
export function parseDecimalToMinor(input: string, minorDigits = 2): bigint {
  const normalized = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    throw new ValidationError('AMOUNT_INVALID', `Cannot parse amount: ${input}`);
  }
  const [intPartRaw, fracRaw = ''] = normalized.split('.') as [string, string?];
  const frac = (fracRaw ?? '').slice(0, minorDigits).padEnd(minorDigits, '0');
  const extra = (fracRaw ?? '').slice(minorDigits);
  if (extra && /[1-9]/.test(extra)) {
    throw new ValidationError('AMOUNT_PRECISION', `Too many decimal places: ${input}`);
  }
  const negative = intPartRaw.startsWith('-');
  const intPart = negative ? intPartRaw.slice(1) : intPartRaw;
  const minor = BigInt(intPart) * 10n ** BigInt(minorDigits) + BigInt(frac || '0');
  return negative ? -minor : minor;
}

function parseDecimalScaled(input: string, scale: number): bigint {
  return parseDecimalToMinor(input, scale);
}

/** UI-формат: `12 500 000 сум` (D-09). Не-UZS: `1 250.00 USD`. */
export function formatMoney(amount: Money): string {
  if (amount.currency === 'UZS') {
    const negative = amount.minor < 0n;
    const soum = (negative ? -amount.minor : amount.minor) / 100n; // тийины в UI не показываем
    return `${negative ? '−' : ''}${groupDigits(soum.toString())} сум`;
  }
  const negative = amount.minor < 0n;
  const abs = negative ? -amount.minor : amount.minor;
  const major = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '−' : ''}${groupDigits(major.toString())}.${cents} ${amount.currency}`;
}

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
