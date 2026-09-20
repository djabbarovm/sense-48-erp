/**
 * Настройки Tower: пороги алертов (SPEC §7) и пул-комиссии-гипотезы (SPEC §4).
 *
 * ВАЖНО (решения пользователя):
 * - Это ОТДЕЛЬНЫЕ настройки, НЕ ApprovalPolicy (та остаётся для аппрувов/four-eyes,
 *   включая утверждение % комиссии в коридоре COMMERCIAL_DIRECTOR).
 * - Ставки/правила комиссий §4 УЖЕ реализованы в `property/commission.ts`
 *   (COMMISSION_RULES, computeCommission, corridor, бонусы). Здесь НЕ дублируем —
 *   только то, чего в коде ещё нет: пороги §7 и пул-комиссии девелопера (гипотеза).
 *
 * Phase 1: источник значений — типизированные ДЕФОЛТЫ (числа §7 подтвердим позже).
 * Phase 2: settings-таблица (миграция) сможет переопределять эти значения; сигнатуры
 * функций не изменятся. В бизнес-логике ничего не хардкодим — берём отсюда.
 */
import { isFeatureEnabled } from './features.js';

/* ───────────── §7 Пороги (дефолты, вынести в настройки) ───────────── */
export interface TowerThresholds {
  leadNormWeek: number; // норма новых лидов в неделю
  slaFirstContactMin: number; // SLA первого касания, мин
  staleDays: number; // сделка без движения
  reserveHours: number; // дедлайн брони
  offerDays: number; // возраст висящего оффера
  leaseWarnDays: number; // предупреждение об окончании договора
  receivableCritDays: number; // просрочка дебиторки — критично
  fundAlert: number; // заполняемость фонда, доля [0..1]
  poolAlert: number; // загрузка пула, доля [0..1]
  convAlert: number; // конверсия показ→договор, доля [0..1]
}
export const TOWER_THRESHOLD_DEFAULTS: Readonly<TowerThresholds> = {
  leadNormWeek: 15,
  slaFirstContactMin: 15,
  staleDays: 7,
  reserveHours: 48,
  offerDays: 3,
  leaseWarnDays: 90,
  receivableCritDays: 7,
  fundAlert: 0.6,
  poolAlert: 0.7,
  convAlert: 0.2,
};

/** Читает пороги из настроек (Phase 2: settings-таблица), иначе — дефолты §7. */
export function towerThresholdsFrom(settings: Record<string, unknown> | null | undefined): TowerThresholds {
  const num = (k: keyof TowerThresholds) => {
    const v = Number(settings?.[k]);
    return Number.isFinite(v) && v >= 0 ? v : TOWER_THRESHOLD_DEFAULTS[k];
  };
  return {
    leadNormWeek: num('leadNormWeek'),
    slaFirstContactMin: num('slaFirstContactMin'),
    staleDays: num('staleDays'),
    reserveHours: num('reserveHours'),
    offerDays: num('offerDays'),
    leaseWarnDays: num('leaseWarnDays'),
    receivableCritDays: num('receivableCritDays'),
    fundAlert: num('fundAlert'),
    poolAlert: num('poolAlert'),
    convAlert: num('convAlert'),
  };
}

/* ───────────── §4 Пул-комиссии девелопера — ГИПОТЕЗА (за фиче-флагом) ───────────── */
/** SPEC §4: DEV_PARKING_POOL / STORAGE_POOL — регулярные 15% от собранной аренды, статус HYPOTHESIS. */
export const TOWER_POOL_COMMISSION_BP = 1500;

/**
 * Регулярное вознаграждение управления пулом (15% от собранного) — только если
 * включён FEATURE_POOL_COMMISSIONS; иначе 0n (гипотеза не начисляется). Разовые
 * комиссии сделок считаются существующим computeCommission (property/commission.ts).
 */
export function poolManagementCommissionMinor(
  collectedRentMinor: bigint,
  opts?: { rateBp?: number; featureOverride?: Parameters<typeof isFeatureEnabled>[1] },
): bigint {
  if (!isFeatureEnabled('POOL_COMMISSIONS', opts?.featureOverride)) return 0n;
  if (collectedRentMinor <= 0n) return 0n;
  const rateBp = opts?.rateBp ?? TOWER_POOL_COMMISSION_BP;
  return (collectedRentMinor * BigInt(Math.round(rateBp))) / 10_000n;
}
