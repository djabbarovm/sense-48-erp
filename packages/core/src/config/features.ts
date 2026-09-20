/**
 * Фиче-флаги Tower (SPEC §0, §9). Дефолты выключены для незакрытых направлений.
 * Значения читаются из env (`FEATURE_STR`, `FEATURE_MALL`, `FEATURE_POOL_COMMISSIONS`),
 * иначе — безопасный дефолт. Модуль изолирован от рантайма: если process.env
 * недоступен (браузер), возвращаются дефолты. Обратимо: правится только здесь.
 *
 * Phase 1: источник — env/дефолты. Phase 2: те же ключи можно переопределять из
 * settings-таблицы (см. towerSettings), сигнатура функций не меняется.
 */
export type FeatureFlag = 'STR' | 'MALL' | 'POOL_COMMISSIONS';

/** Дефолты фиче-флагов. STR и ТРЦ (MALL) — на паузе; пулы девелопера — гипотеза. */
export const FEATURE_DEFAULTS: Readonly<Record<FeatureFlag, boolean>> = {
  STR: false,
  MALL: false,
  POOL_COMMISSIONS: false,
};

function readEnv(name: string): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (globalThis as any)?.process?.env;
    return env ? env[name] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Включён ли флаг. Приоритет: явный override (для тестов/DI) → env → дефолт.
 * Строка из env считается true только при значении "true"/"1" (без учёта регистра).
 */
export function isFeatureEnabled(flag: FeatureFlag, override?: Partial<Record<FeatureFlag, boolean>>): boolean {
  if (override && flag in override) return Boolean(override[flag]);
  const raw = readEnv(`FEATURE_${flag}`);
  if (raw != null) return /^(true|1)$/i.test(raw.trim());
  return FEATURE_DEFAULTS[flag];
}
