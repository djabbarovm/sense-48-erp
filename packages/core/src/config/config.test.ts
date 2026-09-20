import { describe, expect, it } from 'vitest';
import {
  FEATURE_DEFAULTS,
  isFeatureEnabled,
  TOWER_THRESHOLD_DEFAULTS,
  towerThresholdsFrom,
  poolManagementCommissionMinor,
  TOWER_POOL_COMMISSION_BP,
} from './index.js';
// §4 комиссии УЖЕ в property/commission.ts — проверяем соответствие SPEC, не дублируем.
import { COMMISSION_RULES } from '../property/commission.js';

describe('Tower feature flags (SPEC §0, §9)', () => {
  it('дефолты: STR/MALL/пулы выключены', () => {
    expect(FEATURE_DEFAULTS).toEqual({ STR: false, MALL: false, POOL_COMMISSIONS: false });
    expect(isFeatureEnabled('STR')).toBe(false);
    expect(isFeatureEnabled('MALL')).toBe(false);
    expect(isFeatureEnabled('POOL_COMMISSIONS')).toBe(false);
  });
  it('override включает флаг (для DI/тестов)', () => {
    expect(isFeatureEnabled('STR', { STR: true })).toBe(true);
    expect(isFeatureEnabled('MALL', { STR: true })).toBe(false); // override только для указанного
  });
});

describe('Tower thresholds (SPEC §7 — дефолты)', () => {
  it('значения по умолчанию присутствуют и в разумных пределах', () => {
    expect(TOWER_THRESHOLD_DEFAULTS.leadNormWeek).toBe(15);
    expect(TOWER_THRESHOLD_DEFAULTS.slaFirstContactMin).toBe(15);
    expect(TOWER_THRESHOLD_DEFAULTS.leaseWarnDays).toBe(90);
    expect(TOWER_THRESHOLD_DEFAULTS.fundAlert).toBeGreaterThan(0);
    expect(TOWER_THRESHOLD_DEFAULTS.fundAlert).toBeLessThan(1);
    expect(TOWER_THRESHOLD_DEFAULTS.convAlert).toBeLessThan(1);
  });
  it('override из настроек с фолбэком на дефолт (Phase 2: settings-таблица)', () => {
    const t = towerThresholdsFrom({ leadNormWeek: 20, staleDays: -1 });
    expect(t.leadNormWeek).toBe(20); // взято из настроек
    expect(t.staleDays).toBe(TOWER_THRESHOLD_DEFAULTS.staleDays); // невалидное → дефолт
    expect(t.slaFirstContactMin).toBe(15); // не задано → дефолт
  });
});

describe('Commission rules уже в коде соответствуют SPEC §4 (preserve, не дублируем)', () => {
  it('аренда 50% первого месяца; продажа 3% коридор 1.5–3%; STR/ТРЦ — OPEN (rateBp=null)', () => {
    expect(COMMISSION_RULES.LEASE_LTR.rateBp).toBe(5000);
    expect(COMMISSION_RULES.LEASE_OFFICE.rateBp).toBe(5000);
    expect(COMMISSION_RULES.SALE.rateBp).toBe(300);
    expect(COMMISSION_RULES.SALE.corridorBp).toEqual([150, 300]);
    expect(COMMISSION_RULES.STR_MANDATE.rateBp).toBeNull(); // OPEN, paused
    expect(COMMISSION_RULES.MALL_LEASE.rateBp).toBeNull(); // OPEN, paused
  });
});

describe('Пул-комиссии девелопера — HYPOTHESIS за фиче-флагом (SPEC §4)', () => {
  it('0 без флага; 15% от собранного с флагом', () => {
    expect(TOWER_POOL_COMMISSION_BP).toBe(1500);
    expect(poolManagementCommissionMinor(1_000_00n)).toBe(0n); // флаг выключен
    expect(poolManagementCommissionMinor(1_000_00n, { featureOverride: { POOL_COMMISSIONS: true } })).toBe(150_00n); // 15%
    expect(poolManagementCommissionMinor(0n, { featureOverride: { POOL_COMMISSIONS: true } })).toBe(0n);
  });
});
