/**
 * MDS Property — начисление аренды и дебиторка (blueprint §1.7 Finance, §1.8 «юниты c задолженностью», §9 Finance).
 * Начисление — на месяц вперёд по действующему договору; оплата признаётся ТОЛЬКО по банковской транзакции (BR-P37,
 * зеркало non-negotiable №6). Пропорция по дням в первом/последнем месяце (BR-P38).
 */
import { ValidationError } from '../errors/index.js';

export const RENT_CHARGE_STATUSES = ['DUE', 'PARTIAL', 'OVERDUE', 'PAID', 'WAIVED'] as const;
export type RentChargeStatus = (typeof RENT_CHARGE_STATUSES)[number];
/** Статусы c непогашенным остатком. */
export const OPEN_RENT_STATUSES: readonly RentChargeStatus[] = ['DUE', 'PARTIAL', 'OVERDUE'];
export const DEFAULT_RENT_GRACE_DAYS = 5;

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const dayStart = (d: Date) => utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const daysBetween = (a: Date, b: Date) => Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / 86_400_000);

export interface RentPeriod {
  periodStart: Date; // первый день (UTC)
  periodEnd: Date; // последний день включительно
  amountMinor: bigint;
  /** true — месяц начислен не целиком (заезд/выезд в середине). */
  prorated: boolean;
}

/** Первый месяц: от даты начала; последний: до даты окончания включительно; остальные — целиком. Пропорция по дням месяца. */
export function prorateRent(rentMinor: bigint, monthStart: Date, leaseStart: Date, leaseEnd: Date | null): RentPeriod | null {
  if (rentMinor < 0n) throw new ValidationError('RENT_INVALID');
  const y = monthStart.getUTCFullYear();
  const m = monthStart.getUTCMonth();
  const monthEnd = utc(y, m + 1, 0);
  const daysInMonth = monthEnd.getUTCDate();
  const from = dayStart(leaseStart) > monthStart ? dayStart(leaseStart) : monthStart;
  const to = leaseEnd && dayStart(leaseEnd) < monthEnd ? dayStart(leaseEnd) : monthEnd;
  if (to < from) return null;
  const days = daysBetween(from, to) + 1;
  const full = days === daysInMonth;
  const amountMinor = full ? rentMinor : (rentMinor * BigInt(days)) / BigInt(daysInMonth);
  return { periodStart: from, periodEnd: to, amountMinor, prorated: !full };
}

/** Месяцы договора, для которых пора начислять: от старта до месяца `upTo` включительно (не позже конца договора). */
export function rentPeriods(rentMinor: bigint, leaseStart: Date, leaseEnd: Date | null, upTo: Date): RentPeriod[] {
  const out: RentPeriod[] = [];
  const last = leaseEnd && dayStart(leaseEnd) < dayStart(upTo) ? dayStart(leaseEnd) : dayStart(upTo);
  let cursor = utc(leaseStart.getUTCFullYear(), leaseStart.getUTCMonth(), 1);
  while (cursor <= last) {
    const p = prorateRent(rentMinor, cursor, leaseStart, leaseEnd);
    if (p && p.amountMinor > 0n) out.push(p);
    cursor = utc(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1);
  }
  return out;
}

export function rentDueAt(periodStart: Date, graceDays = DEFAULT_RENT_GRACE_DAYS): Date {
  return new Date(dayStart(periodStart).getTime() + graceDays * 86_400_000);
}

/** BR-P37: статус выводится из полученной суммы и срока; PAID только когда получено ≥ начислено. */
export function rentChargeStatus(c: { amountMinor: bigint; receivedMinor: bigint; dueAt: Date; status?: RentChargeStatus }, now: Date): RentChargeStatus {
  if (c.status === 'WAIVED') return 'WAIVED';
  if (c.receivedMinor >= c.amountMinor) return 'PAID';
  if (dayStart(c.dueAt) < dayStart(now)) return 'OVERDUE';
  return c.receivedMinor > 0n ? 'PARTIAL' : 'DUE';
}

export function outstandingOf(c: { amountMinor: bigint; receivedMinor: bigint; status: RentChargeStatus }): bigint {
  if (c.status === 'WAIVED' || c.status === 'PAID') return 0n;
  const rest = c.amountMinor - c.receivedMinor;
  return rest > 0n ? rest : 0n;
}

/** Сумма зачёта банковской транзакции в начисление: положительная, не больше остатка (переплата — отдельный аванс, не здесь). */
export function validateReceipt(amountMinor: bigint, outstandingMinor: bigint): bigint {
  if (amountMinor <= 0n) throw new ValidationError('AMOUNT_INVALID', 'AMOUNT_INVALID: зачёт должен быть положительным');
  if (amountMinor > outstandingMinor) throw new ValidationError('OVERPAYMENT', 'OVERPAYMENT: сумма больше остатка по начислению');
  return amountMinor;
}
