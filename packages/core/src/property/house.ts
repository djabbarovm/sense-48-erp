/**
 * ORDO Operations — деньги дома (бизнес-модель Operations v1.0, разделы 4A, 6, 8; ЗРУ-581 ст. 16).
 * Деньги дома ≠ деньги ORDO (BR-P52): взносы собственников идут на счёт дома и тратятся на утверждённый бюджет;
 * вознаграждение ORDO — отдельная строка (размер OPEN до Quantum Law). Взносы — пропорционально площади по кадастру
 * (BR-P51; до кадастра — договорная площадь c пометкой). Годовой перерасчёт: сверхпоступления → в счёт будущего,
 * недоборы → в следующий период (BR-P54). Оплата признаётся только банком (BR-P53, как аренда и комиссии).
 */
import { ValidationError } from '../errors/index.js';

export const HOUSE_FUND_KINDS = ['OPERATIONS', 'MARKETING', 'CAPEX'] as const;
export type HouseFundKind = (typeof HOUSE_FUND_KINDS)[number];
/** Статьи эксплуатационного бюджета — каркас по методике министерства (Operations §8.2), compliance-floor не срезается. */
export const HOUSE_BUDGET_CATEGORIES = ['ENGINEERING', 'LIFTS', 'FIRE_SAFETY', 'SECURITY', 'CLEANING', 'UTILITIES_COMMON', 'REPAIRS', 'MATERIALS', 'INSURANCE_LICENSES', 'ADMIN', 'OTHER'] as const;
export type HouseBudgetCategory = (typeof HOUSE_BUDGET_CATEGORIES)[number];
/** Обязательные нормы (ЗРУ-226, Правила № 3824): нижняя граница, которую нельзя исключить ради тарифа. */
export const COMPLIANCE_FLOOR_CATEGORIES: readonly HouseBudgetCategory[] = ['LIFTS', 'FIRE_SAFETY', 'ENGINEERING'];
export const MANAGEMENT_CONTRACT_STATUSES = ['NONE', 'SENT', 'SIGNED', 'DECLINED'] as const;
export type ManagementContractStatus = (typeof MANAGEMENT_CONTRACT_STATUSES)[number];
export const DEFAULT_HOUSE_DUE_DAY = 15; // акт от 05.02.2026: взносы на счёт дома до 15 числа

/** BR-P51: взнос = площадь × тариф за м²; площадь — кадастровая, иначе договорная c пометкой preCadastre. */
export function houseContribution(areaM2: number, cadastralAreaM2: number | null, tariffPerM2Minor: bigint): { amountMinor: bigint; areaM2: number; preCadastre: boolean } {
  const area = cadastralAreaM2 ?? areaM2;
  if (!(area > 0)) throw new ValidationError('AREA_REQUIRED');
  if (tariffPerM2Minor < 0n) throw new ValidationError('TARIFF_INVALID');
  return { amountMinor: (tariffPerM2Minor * BigInt(Math.round(area * 100))) / 100n, areaM2: area, preCadastre: cadastralAreaM2 == null };
}

export function houseDueAt(periodStart: Date, dueDay = DEFAULT_HOUSE_DUE_DAY): Date {
  return new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), Math.min(28, Math.max(1, dueDay))));
}

/** Вознаграждение ORDO — отдельная строка; ставка и база OPEN → null (Operations §7). */
export function managementFeeLine(collectedMinor: bigint, feeBp: number | null): bigint | null {
  if (feeBp == null) return null;
  if (feeBp < 0 || feeBp > 10_000) throw new ValidationError('FEE_INVALID');
  return (collectedMinor * BigInt(feeBp)) / 10_000n;
}

/** Сценарии собираемости 70/85/95% (Operations §13.2): финмодель не предполагает 100%. */
export function collectionScenarios(chargedMinor: bigint, pcts: readonly number[] = [70, 85, 95]): { pct: number; collectedMinor: bigint }[] {
  return pcts.map((pct) => ({ pct, collectedMinor: (chargedMinor * BigInt(pct)) / 100n }));
}

export interface AnnualRecalc {
  chargedMinor: bigint;
  collectedMinor: bigint;
  spentMinor: bigint;
  /** Остаток денег дома (собрано − потрачено); > 0 → в счёт будущей оплаты, < 0 → недобор в следующий период. */
  balanceMinor: bigint;
  carryForwardCreditMinor: bigint;
  shortfallMinor: bigint;
  collectionPct: number | null;
}

/** BR-P54 (ст. 16): окончательный расчёт по году — сверхпоступления не прибыль ORDO, а кредит собственникам. */
export function annualRecalc(chargedMinor: bigint, collectedMinor: bigint, spentMinor: bigint): AnnualRecalc {
  const balance = collectedMinor - spentMinor;
  return { chargedMinor, collectedMinor, spentMinor, balanceMinor: balance, carryForwardCreditMinor: balance > 0n ? balance : 0n, shortfallMinor: balance < 0n ? -balance : 0n, collectionPct: chargedMinor > 0n ? Math.round(Number((collectedMinor * 1000n) / chargedMinor)) / 10 : null };
}

export interface BudgetVsActualLine { category: HouseBudgetCategory; plannedMinor: bigint; actualMinor: bigint; varianceMinor: bigint; complianceFloor: boolean }

export function budgetVsActual(planned: { category: HouseBudgetCategory; plannedMinor: bigint }[], actual: { category: HouseBudgetCategory; amountMinor: bigint }[]): BudgetVsActualLine[] {
  const cats = new Set<HouseBudgetCategory>([...planned.map((p) => p.category), ...actual.map((a) => a.category)]);
  return [...cats].map((category) => {
    const p = planned.filter((x) => x.category === category).reduce((s, x) => s + x.plannedMinor, 0n);
    const a = actual.filter((x) => x.category === category).reduce((s, x) => s + x.amountMinor, 0n);
    return { category, plannedMinor: p, actualMinor: a, varianceMinor: a - p, complianceFloor: COMPLIANCE_FLOOR_CATEGORIES.includes(category) };
  }).sort((x, y) => Number(y.plannedMinor - x.plannedMinor));
}

/** Bottom-up тариф (Operations §8): полная себестоимость года / оплачиваемая площадь / 12. */
export function bottomUpTariff(annualCostMinor: bigint, payableAreaM2: number): bigint {
  if (!(payableAreaM2 > 0)) throw new ValidationError('AREA_REQUIRED');
  return annualCostMinor / BigInt(Math.round(payableAreaM2)) / 12n;
}
