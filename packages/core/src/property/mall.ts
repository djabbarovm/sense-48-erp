/**
 * MDS Property — ORDO Mall, коммерческая часть (бизнес-модель Mall v1.1, гибридная модель выручки).
 * Мандат (ДДУ) собственника помещения ТРЦ → контролируемая база = подписанные ДДУ × сданные площади × собранная аренда;
 * регулярное вознаграждение (asset management fee) — % от собранной аренды контролируемой базы, размер OPEN до тройной
 * сверки (KSP + Quantum Law + Botyr): проценты не публикуются собственникам, пока не утверждены (BR-P46).
 * Tenant mix, вакантность по GLA, линии актива (медиа, островки, паркинг — 100% ORDO по конструкции C), экономика
 * собственника «c ORDO / без ORDO» на 5 лет (раздел 5 — условие гейта для любого вознаграждения).
 */
import { StateMachine } from '../workflows/stateMachine.js';
import { ValidationError } from '../errors/index.js';

export const TENANT_CATEGORIES = ['FASHION', 'FOOD_BEVERAGE', 'GROCERY', 'SERVICES', 'BEAUTY_HEALTH', 'ELECTRONICS', 'KIDS', 'SPORTS', 'ENTERTAINMENT', 'HOME', 'OTHER'] as const;
export type TenantCategory = (typeof TENANT_CATEGORIES)[number];

export const MANDATE_STATUSES = ['DRAFT', 'SIGNED', 'ACTIVE', 'TERMINATED'] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];
export type MandateTrigger = 'sign' | 'activate' | 'terminate';

export interface MandatePayload {
  hasOwner: boolean;
  otherActiveOnUnit: boolean;
  reason?: string | undefined;
}

/** BR-P45: один действующий мандат на помещение; активация делает помещение управляемым (аренда собирается ORDO). */
export const mandateMachine = new StateMachine<MandateStatus, MandateTrigger, MandatePayload>('mall_mandate', {
  sign: { from: ['DRAFT'], to: 'SIGNED', permission: 'mall.manage', guard: ({ payload }) => { if (!payload.hasOwner) throw new ValidationError('MANDATE_OWNER_REQUIRED', 'MANDATE_OWNER_REQUIRED: у помещения нет собственника'); } },
  activate: { from: ['SIGNED'], to: 'ACTIVE', permission: 'mall.manage', guard: ({ payload }) => { if (payload.otherActiveOnUnit) throw new ValidationError('MANDATE_ALREADY_ACTIVE', 'MANDATE_ALREADY_ACTIVE: по помещению уже действует мандат'); } },
  terminate: { from: ['DRAFT', 'SIGNED', 'ACTIVE'], to: 'TERMINATED', permission: 'mall.manage', guard: ({ payload }) => { if (!payload.reason?.trim()) throw new ValidationError('REASON_REQUIRED'); } },
});

export const ASSET_KINDS = ['MEDIA', 'ISLAND', 'PARKING', 'PARTNERSHIP'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

// ── Агрегаты ТРЦ ──

export interface MallUnitInput {
  id: string;
  floorNo: number;
  areaM2: number;
  isCommercial: boolean;
  readiness: string;
  occupied: boolean;
  monthlyRentMinor: bigint | null;
  askingRateMinor: bigint | null;
  tenantCategory: TenantCategory | null;
  mandateStatus: MandateStatus | null;
  vacantDays: number | null;
  leaseEndsInDays: number | null;
}

export interface MallKpi {
  glaM2: number;
  leasedGlaM2: number;
  vacantGlaM2: number;
  renovationGlaM2: number;
  occupancyByGlaPct: number;
  units: number;
  leasedUnits: number;
  currentRentMinor: bigint;
  /** Средняя договорная ставка, $/м²/мес × 100 (minor за м²) по сданным. */
  avgRatePerM2Minor: bigint;
  avgVacantDays: number | null;
  expiring90: number;
  /** Контролируемая база: помещения c действующим мандатом. */
  mandateActive: number;
  mandateSigned: number;
  mandateCoverageGlaPct: number;
  controlledLeasedGlaM2: number;
  controlledRentMinor: bigint;
}

export function mallKpi(units: MallUnitInput[]): MallKpi {
  const com = units.filter((u) => u.isCommercial);
  const gla = com.reduce((a, u) => a + u.areaM2, 0);
  const leased = com.filter((u) => u.occupied);
  const reno = com.filter((u) => u.readiness !== 'READY');
  const vacant = com.filter((u) => !u.occupied && u.readiness === 'READY');
  const leasedGla = leased.reduce((a, u) => a + u.areaM2, 0);
  const rent = leased.reduce((a, u) => a + (u.monthlyRentMinor ?? 0n), 0n);
  const active = com.filter((u) => u.mandateStatus === 'ACTIVE');
  const activeLeased = active.filter((u) => u.occupied);
  const vd = vacant.map((u) => u.vacantDays).filter((x): x is number => x != null);
  return {
    glaM2: r2(gla), leasedGlaM2: r2(leasedGla), vacantGlaM2: r2(vacant.reduce((a, u) => a + u.areaM2, 0)), renovationGlaM2: r2(reno.reduce((a, u) => a + u.areaM2, 0)),
    occupancyByGlaPct: gla > 0 ? Math.round((leasedGla / gla) * 1000) / 10 : 0, units: com.length, leasedUnits: leased.length, currentRentMinor: rent,
    avgRatePerM2Minor: leasedGla > 0 ? rent / BigInt(Math.max(1, Math.round(leasedGla))) : 0n,
    avgVacantDays: vd.length ? Math.round(vd.reduce((a, b) => a + b, 0) / vd.length) : null,
    expiring90: com.filter((u) => u.leaseEndsInDays != null && u.leaseEndsInDays >= 0 && u.leaseEndsInDays <= 90).length,
    mandateActive: active.length, mandateSigned: com.filter((u) => u.mandateStatus === 'SIGNED').length,
    mandateCoverageGlaPct: gla > 0 ? Math.round((active.reduce((a, u) => a + u.areaM2, 0) / gla) * 1000) / 10 : 0,
    controlledLeasedGlaM2: r2(activeLeased.reduce((a, u) => a + u.areaM2, 0)), controlledRentMinor: activeLeased.reduce((a, u) => a + (u.monthlyRentMinor ?? 0n), 0n),
  };
}
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface TenantMixLine { category: TenantCategory; units: number; glaM2: number; sharePct: number; rentMinor: bigint }

/** Состав арендаторов по категориям (доля сданной GLA). Без категории → OTHER. */
export function tenantMix(units: MallUnitInput[]): TenantMixLine[] {
  const leased = units.filter((u) => u.isCommercial && u.occupied);
  const total = leased.reduce((a, u) => a + u.areaM2, 0);
  const by = new Map<TenantCategory, TenantMixLine>();
  for (const u of leased) {
    const c = u.tenantCategory ?? 'OTHER';
    const l = by.get(c) ?? { category: c, units: 0, glaM2: 0, sharePct: 0, rentMinor: 0n };
    l.units++; l.glaM2 = r2(l.glaM2 + u.areaM2); l.rentMinor += u.monthlyRentMinor ?? 0n;
    by.set(c, l);
  }
  return [...by.values()].map((l) => ({ ...l, sharePct: total > 0 ? Math.round((l.glaM2 / total) * 1000) / 10 : 0 })).sort((a, b) => b.glaM2 - a.glaM2);
}

/** Ставочные сценарии по этажам ($/м²/мес, minor) → потенциальная месячная аренда всей GLA (модель §9 A). */
export interface RateScenario { conservative: bigint; base: bigint; optimistic: bigint }
export function potentialRentByScenario(units: MallUnitInput[], ratesByFloor: Record<string, RateScenario>, fallback: RateScenario): Record<keyof RateScenario, bigint> {
  const out = { conservative: 0n, base: 0n, optimistic: 0n };
  for (const u of units.filter((x) => x.isCommercial)) {
    const r = ratesByFloor[String(u.floorNo)] ?? fallback;
    const area = BigInt(Math.round(u.areaM2));
    out.conservative += r.conservative * area; out.base += r.base * area; out.optimistic += r.optimistic * area;
  }
  return out;
}

/** BR-P46: вознаграждение ORDO c контролируемой базы считается только при утверждённой ставке (feeBp ≠ null). */
export function assetManagementFee(collectedRentMinor: bigint, feeBp: number | null): bigint | null {
  if (feeBp == null) return null;
  if (feeBp < 0 || feeBp > 10_000) throw new ValidationError('FEE_INVALID');
  return (collectedRentMinor * BigInt(feeBp)) / 10_000n;
}

// ── Экономика собственника «c ORDO / без ORDO» на 5 лет (Mall §5) ──

export interface OwnerEconomicsInput {
  areaM2: number;
  /** Стартовая ставка $/м²/мес (minor). */
  rateMinor: bigint;
  years?: number;
  indexationPct: number; // в год, c ORDO
  indexationPctWithout: number; // в год, без ORDO
  /** Простой между арендаторами, дней за 5 лет. */
  vacancyDaysWithout: number;
  vacancyDaysWith: number;
  /** Смены арендатора за период (брокерская комиссия при каждой, в месяцах аренды) — без ORDO. */
  tenantChangesWithout: number;
  brokerFeeMonths: number;
  /** Льготы c ORDO: месяцы бесплатной отделки и месяцы льготной ставки (доля). */
  fitoutFreeMonths: number;
  discountedMonths: number;
  discountPct: number;
  /** Вознаграждение ORDO: регулярное (б.п. от собранной) и success fee (месяцев аренды за сделку). null — не утверждено. */
  feeBp: number | null;
  successFeeMonths: number | null;
  ordoDeals: number;
}

export interface OwnerEconomics {
  years: number;
  without: { grossMinor: bigint; vacancyMinor: bigint; brokerMinor: bigint; netMinor: bigint };
  with: { grossMinor: bigint; vacancyMinor: bigint; concessionsMinor: bigint; feeMinor: bigint | null; successFeeMinor: bigint | null; netMinor: bigint | null };
  /** Разница net (c ORDO − без); null, если вознаграждение не утверждено. */
  deltaMinor: bigint | null;
}

export function ownerEconomics(i: OwnerEconomicsInput): OwnerEconomics {
  const years = i.years ?? 5;
  const area = BigInt(Math.round(i.areaM2));
  const monthly = (rate: bigint) => rate * area;
  const yearGross = (indexPct: number) => { let g = 0n; let rate = i.rateMinor; for (let y = 0; y < years; y++) { g += monthly(rate) * 12n; rate = (rate * BigInt(10_000 + Math.round(indexPct * 100))) / 10_000n; } return g; };
  const dayRate = (g: bigint) => g / BigInt(years * 365);
  const gW0 = yearGross(i.indexationPctWithout);
  const vacW0 = dayRate(gW0) * BigInt(i.vacancyDaysWithout);
  const brokerW0 = monthly(i.rateMinor) * BigInt(Math.round(i.brokerFeeMonths * i.tenantChangesWithout));
  const gW1 = yearGross(i.indexationPct);
  const vacW1 = dayRate(gW1) * BigInt(i.vacancyDaysWith);
  const concessions = monthly(i.rateMinor) * BigInt(i.fitoutFreeMonths) + (monthly(i.rateMinor) * BigInt(i.discountedMonths) * BigInt(Math.round(i.discountPct * 100))) / 10_000n;
  const collected = gW1 - vacW1 - concessions;
  const fee = i.feeBp == null ? null : (collected * BigInt(i.feeBp)) / 10_000n;
  // success fee не задан → считаем 0 (OPEN), но чистый результат показываем: гейт решает регулярное вознаграждение
  const success = i.successFeeMonths == null ? null : (monthly(i.rateMinor) * BigInt(Math.round(i.successFeeMonths * 100)) * BigInt(i.ordoDeals)) / 100n;
  const netWith = fee == null ? null : collected - fee - (success ?? 0n);
  return {
    years,
    without: { grossMinor: gW0, vacancyMinor: vacW0, brokerMinor: brokerW0, netMinor: gW0 - vacW0 - brokerW0 },
    with: { grossMinor: gW1, vacancyMinor: vacW1, concessionsMinor: concessions, feeMinor: fee, successFeeMinor: success, netMinor: netWith },
    deltaMinor: netWith == null ? null : netWith - (gW0 - vacW0 - brokerW0),
  };
}
