/**
 * CRM Tower — воронка собственников (docs/20 §11.15; бизнес-модель Tower §H4 «конверсия и удержание собственников»).
 * Стадии: LEAD → CONTACTED → CALC_SHOWN → CONSENT → CONTRACT_SENT → SIGNED → HANDED_OVER; LOST из любой незавершённой.
 * Правило бизнес-модели: собственнику всегда показываем расчёт трёх сценариев STR / mid-term / LTR и рекомендуем
 * тот, где выше его чистый доход, а не тот, что выгоднее ORDO. Ставка STR fee не зафиксирована (OPEN) — расчёт помечается.
 */
import { ValidationError } from '../errors/index.js';

export const OWNER_STAGES = ['LEAD', 'CONTACTED', 'CALC_SHOWN', 'CONSENT', 'CONTRACT_SENT', 'SIGNED', 'HANDED_OVER', 'LOST'] as const;
export type OwnerStage = (typeof OWNER_STAGES)[number];
export const OWNER_ACTIVE_STAGES: readonly OwnerStage[] = ['LEAD', 'CONTACTED', 'CALC_SHOWN', 'CONSENT', 'CONTRACT_SENT', 'SIGNED'];
export const OWNER_LOST_REASONS = ['SELF_MANAGES', 'OTHER_OPERATOR', 'FEE', 'TRUST', 'SELLING', 'NO_RESPONSE', 'OTHER'] as const;
export type OwnerLostReason = (typeof OWNER_LOST_REASONS)[number];

const ORDER: Record<OwnerStage, number> = { LEAD: 0, CONTACTED: 1, CALC_SHOWN: 2, CONSENT: 3, CONTRACT_SENT: 4, SIGNED: 5, HANDED_OVER: 6, LOST: 99 };

/** Вперёд — на любую стадию; назад — на один шаг (исправление); LOST — из любой незавершённой; из LOST — только CONTACTED (reopen). */
export function canMoveOwnerStage(from: OwnerStage, to: OwnerStage): boolean {
  if (from === to) return false;
  if (from === 'LOST') return to === 'CONTACTED';
  if (to === 'LOST') return from !== 'HANDED_OVER';
  if (from === 'HANDED_OVER') return false;
  return ORDER[to] > ORDER[from] || ORDER[to] === ORDER[from] - 1;
}
export function assertOwnerStageMove(from: OwnerStage, to: OwnerStage): void {
  if (!canMoveOwnerStage(from, to)) throw new ValidationError('OWNER_STAGE_ILLEGAL', `OWNER_STAGE_ILLEGAL: ${from} → ${to}`);
}

export const OWNER_SEGMENTS = ['STUDIO', 'ONE_BED', 'TWO_BED', 'LARGE', 'OFFICE', 'RETAIL', 'MIXED', 'NONE'] as const;
export type OwnerSegment = (typeof OWNER_SEGMENTS)[number];

/** Сегмент собственника по помещениям (H4: «структура квартир по сегментам; конверсия по сегментам»). */
export function ownerSegment(units: { type: string; areaM2: number }[]): OwnerSegment {
  if (units.length === 0) return 'NONE';
  const segs = new Set(units.map((u) => (u.type === 'OFFICE' ? 'OFFICE' : u.type === 'RETAIL' ? 'RETAIL' : u.areaM2 < 45 ? 'STUDIO' : u.areaM2 < 70 ? 'ONE_BED' : u.areaM2 < 100 ? 'TWO_BED' : 'LARGE')));
  return segs.size === 1 ? ([...segs][0] as OwnerSegment) : 'MIXED';
}

// ── Расчёт трёх сценариев ──

export interface OwnerCalcInput {
  /** Рыночная месячная аренда LTR (USD, minor). Обязательна. */
  ltrMonthlyMinor: bigint;
  /** Месячная mid-term (по умолчанию LTR × midMultiplier). */
  midMonthlyMinor?: bigint | null;
  /** Средняя ставка за ночь STR (по умолчанию LTR/30 × strAdrMultiplier). */
  strAdrMinor?: bigint | null;
  strOccupancyPct?: number;      // по умолчанию 65
  ltrVacancyMonths?: number;     // по умолчанию 1 (ротация ~50%/год, поиск арендатора)
  midVacancyMonths?: number;     // по умолчанию 1.5
  midMultiplier?: number;        // по умолчанию 1.25
  strAdrMultiplier?: number;     // по умолчанию 2.0 к LTR/30
  strOpexPct?: number;           // opex STR (уборка между гостями, бельё, комм.) % от валовой, по умолчанию 20
  /** Ставка ORDO за управление STR (bp). null → OPEN: считаем c assumedStrFeeBp и помечаем. */
  strFeeBp?: number | null;
  assumedStrFeeBp?: number;      // по умолчанию 2000 — только для иллюстрации
}
export interface OwnerScenario {
  key: 'LTR' | 'MID' | 'STR';
  grossAnnualMinor: bigint;
  ordoFeeAnnualMinor: bigint;
  opexAnnualMinor: bigint;
  ownerNetAnnualMinor: bigint;
  ownerNetMonthlyMinor: bigint;
  feeOpen: boolean;
  assumptions: string[];
}
export interface OwnerCalc { scenarios: OwnerScenario[]; recommended: OwnerScenario['key']; provisional: boolean }

const pct = (v: bigint, p: number) => (v * BigInt(Math.round(p * 100))) / 10_000n;

export function ownerScenarios(i: OwnerCalcInput): OwnerCalc {
  if (i.ltrMonthlyMinor <= 0n) throw new ValidationError('LTR_RENT_REQUIRED');
  const occ = i.strOccupancyPct ?? 65; if (occ < 0 || occ > 100) throw new ValidationError('OCCUPANCY_INVALID');
  const ltrVac = i.ltrVacancyMonths ?? 1; const midVac = i.midVacancyMonths ?? 1.5;
  const mid = i.midMonthlyMinor ?? pct(i.ltrMonthlyMinor, (i.midMultiplier ?? 1.25) * 100);
  const adr = i.strAdrMinor ?? pct(i.ltrMonthlyMinor / 30n, (i.strAdrMultiplier ?? 2.0) * 100);
  const feeOpen = i.strFeeBp == null;
  const strFeeBp = i.strFeeBp ?? i.assumedStrFeeBp ?? 2000;
  // LTR: комиссия 50% месяца платит арендатор (BR-P41) — собственник несёт только простой
  const ltrGross = pct(i.ltrMonthlyMinor, (12 - ltrVac) * 100);
  const ltr: OwnerScenario = { key: 'LTR', grossAnnualMinor: ltrGross, ordoFeeAnnualMinor: 0n, opexAnnualMinor: 0n, ownerNetAnnualMinor: ltrGross, ownerNetMonthlyMinor: ltrGross / 12n, feeOpen: false, assumptions: [`простой ${ltrVac} мес/год`, 'комиссию ORDO платит арендатор'] };
  const midGross = pct(mid, (12 - midVac) * 100);
  const midS: OwnerScenario = { key: 'MID', grossAnnualMinor: midGross, ordoFeeAnnualMinor: 0n, opexAnnualMinor: 0n, ownerNetAnnualMinor: midGross, ownerNetMonthlyMinor: midGross / 12n, feeOpen: false, assumptions: [`ставка ×${i.midMultiplier ?? 1.25} к LTR`, `простой ${midVac} мес/год`, 'комиссию ORDO платит арендатор'] };
  const strGross = pct(adr * 365n, occ);
  const opex = pct(strGross, i.strOpexPct ?? 20);
  const fee = (strGross * BigInt(strFeeBp)) / 10_000n;
  const strNet = strGross - opex - fee;
  const str: OwnerScenario = { key: 'STR', grossAnnualMinor: strGross, ordoFeeAnnualMinor: fee, opexAnnualMinor: opex, ownerNetAnnualMinor: strNet, ownerNetMonthlyMinor: strNet / 12n, feeOpen, assumptions: [`загрузка ${occ}%`, `opex ${i.strOpexPct ?? 20}% валовой`, feeOpen ? `ставка ORDO не зафиксирована — иллюстративно ${strFeeBp / 100}%` : `ставка ORDO ${strFeeBp / 100}%`] };
  const scenarios = [ltr, midS, str];
  const best = [...scenarios].sort((a, b) => Number(b.ownerNetAnnualMinor - a.ownerNetAnnualMinor))[0]!;
  return { scenarios, recommended: best.key, provisional: feeOpen && best.key === 'STR' };
}

/** Конверсия воронки: доля дошедших до стадии ≥ target среди всех, кроме NONE-сегмента; для H4 по сегментам. */
export function ownerConversion(rows: { stage: OwnerStage; segment: OwnerSegment }[], target: OwnerStage = 'SIGNED'): { segment: OwnerSegment | 'ALL'; total: number; reached: number; lost: number; pct: number | null }[] {
  const segs: (OwnerSegment | 'ALL')[] = ['ALL', ...OWNER_SEGMENTS];
  return segs.map((seg) => {
    const xs = rows.filter((r) => seg === 'ALL' || r.segment === seg);
    const reached = xs.filter((r) => r.stage !== 'LOST' && ORDER[r.stage] >= ORDER[target]).length;
    return { segment: seg, total: xs.length, reached, lost: xs.filter((r) => r.stage === 'LOST').length, pct: xs.length ? Math.round((reached / xs.length) * 1000) / 10 : null };
  }).filter((r) => r.segment === 'ALL' || r.total > 0);
}
