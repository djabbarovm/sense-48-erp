/**
 * MDS Property — движок статусов юнита (docs/20-mds-property.md §3).
 * Цвет НИКОГДА не хранится: он выводится из нормализованных полей по правилу
 * приоритета Readiness → Occupancy → Rental mode → Contract → Commercial overlay (BR-P01).
 * Модуль чистый: без БД и без React, чтобы backend-фильтр и UI использовали один предикат (BR-P12).
 */

export const READINESS_STATUSES = ['READY', 'RENOVATION', 'FITOUT', 'FURNISHING', 'BLOCKED'] as const;
export const OCCUPANCY_STATUSES = ['VACANT', 'OCCUPIED', 'OWNER_USE', 'UNAVAILABLE'] as const;
export const RENTAL_MODES = ['NONE', 'LTR', 'STR'] as const;
export const LEASE_STATUSES = ['NONE', 'DRAFT', 'ACTIVE', 'EXPIRING', 'TERMINATED'] as const;
export const COMMERCIAL_STATUSES = ['OFF_MARKET', 'AVAILABLE', 'RESERVED', 'VIEWING', 'NEGOTIATION', 'LOI', 'CONTRACTED'] as const;
export const OPERATIONAL_STATUSES = ['NORMAL', 'ISSUE', 'CRITICAL', 'BLOCKED'] as const;
export const UNIT_TYPES = ['APARTMENT', 'OFFICE', 'RETAIL', 'PARKING', 'STORAGE', 'COMMON', 'TECHNICAL'] as const;
export const UNIT_COLORS = ['RED', 'GREY', 'GREEN', 'YELLOW', 'BLUE', 'NEUTRAL'] as const;

export type ReadinessStatus = (typeof READINESS_STATUSES)[number];
export type OccupancyStatus = (typeof OCCUPANCY_STATUSES)[number];
export type RentalMode = (typeof RENTAL_MODES)[number];
export type LeaseStatus = (typeof LEASE_STATUSES)[number];
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number];
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];
export type UnitType = (typeof UNIT_TYPES)[number];
export type UnitColor = (typeof UNIT_COLORS)[number];

/** Поля юнита, от которых зависит отображение. Совпадают с колонками Unit в БД. */
export interface UnitStatusFields {
  type: UnitType;
  readiness: ReadinessStatus;
  occupancy: OccupancyStatus;
  rentalMode: RentalMode;
  leaseStatus: LeaseStatus;
  commercialStatus: CommercialStatus;
  operationalStatus: OperationalStatus;
  vacantSince?: Date | null;
  leaseEndsAt?: Date | null;
}

/** Коды data-quality alert'ов: система не чинит противоречие сама, а подсвечивает его (BR-P03..P07). */
export const DATA_QUALITY_CODES = [
  'RENOVATION_WITH_ACTIVE_LEASE',
  'NOT_READY_BUT_AVAILABLE',
  'OCCUPIED_WITHOUT_RENTAL_MODE',
  'LTR_WITHOUT_ACTIVE_LEASE',
  'VACANT_WITH_ACTIVE_LEASE',
  'OWNER_USE_WITH_RENTAL_MODE',
] as const;
export type DataQualityCode = (typeof DATA_QUALITY_CODES)[number];

export interface UnitView {
  /** Базовый цвет из правила приоритета. */
  color: UnitColor;
  /** Оранжевый overlay переговоров/резерва — не заменяет базовый статус. */
  overlay: 'NEGOTIATION' | null;
  /** Ключ подписи статуса для i18n (цвет никогда не единственный носитель смысла). */
  labelKey: string;
  /** Юнит участвует в коммерческой статистике (не common/technical, BR-P02). */
  isCommercial: boolean;
  /** Доступен к продаже прямо сейчас: готов, свободен, на рынке. */
  isSellable: boolean;
  alerts: DataQualityCode[];
  vacantDays: number | null;
  leaseEndsInDays: number | null;
}

const DAY_MS = 86_400_000;

export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / DAY_MS);
}

export function isCommercialType(type: UnitType): boolean {
  return type !== 'COMMON' && type !== 'TECHNICAL';
}

/** Единственная точка вывода цвета и alert'ов из полей (BR-P01). Детерминирована. */
export function deriveUnitView(u: UnitStatusFields, today: Date = new Date()): UnitView {
  const alerts: DataQualityCode[] = [];
  const leaseActive = u.leaseStatus === 'ACTIVE' || u.leaseStatus === 'EXPIRING';
  const isCommercial = isCommercialType(u.type);

  let color: UnitColor;
  let labelKey: string;

  if (!isCommercial) {
    color = 'NEUTRAL';
    labelKey = u.type === 'COMMON' ? 'common' : 'technical';
  } else if (u.readiness !== 'READY') {
    // 1. Readiness имеет высший приоритет: ремонт показывается серым даже при старом договоре
    color = 'GREY';
    labelKey = `readiness_${u.readiness}`;
    if (leaseActive) alerts.push('RENOVATION_WITH_ACTIVE_LEASE');
    if (u.commercialStatus === 'AVAILABLE') alerts.push('NOT_READY_BUT_AVAILABLE');
  } else if (u.occupancy === 'OWNER_USE') {
    color = 'BLUE';
    labelKey = 'occupancy_OWNER_USE';
    if (u.rentalMode !== 'NONE') alerts.push('OWNER_USE_WITH_RENTAL_MODE');
  } else if (u.occupancy === 'UNAVAILABLE') {
    color = 'NEUTRAL';
    labelKey = 'occupancy_UNAVAILABLE';
  } else if (u.occupancy === 'VACANT') {
    color = 'RED';
    labelKey = 'occupancy_VACANT';
    if (leaseActive) alerts.push('VACANT_WITH_ACTIVE_LEASE');
  } else {
    // OCCUPIED → rental mode решает
    if (u.rentalMode === 'STR') {
      color = 'YELLOW';
      labelKey = 'rental_STR';
    } else {
      color = 'GREEN';
      labelKey = 'rental_LTR';
      if (u.rentalMode === 'NONE') alerts.push('OCCUPIED_WITHOUT_RENTAL_MODE');
      else if (!leaseActive) alerts.push('LTR_WITHOUT_ACTIVE_LEASE');
    }
  }

  const overlay =
    isCommercial && (u.commercialStatus === 'RESERVED' || u.commercialStatus === 'NEGOTIATION' || u.commercialStatus === 'LOI')
      ? 'NEGOTIATION'
      : null;

  const vacantDays = u.occupancy === 'VACANT' && u.vacantSince ? Math.max(0, daysBetween(u.vacantSince, today)) : null;
  const leaseEndsInDays = leaseActive && u.leaseEndsAt ? daysBetween(today, u.leaseEndsAt) : null;
  const isSellable = isCommercial && u.readiness === 'READY' && u.occupancy === 'VACANT' && u.commercialStatus !== 'OFF_MARKET';

  return { color, overlay, labelKey, isCommercial, isSellable, alerts, vacantDays, leaseEndsInDays };
}

// ── Валидация изменения статуса (BR-P04, BR-P10, BR-P11) ──

export interface StatusPatch {
  readiness?: ReadinessStatus;
  occupancy?: OccupancyStatus;
  rentalMode?: RentalMode;
  leaseStatus?: LeaseStatus;
  commercialStatus?: CommercialStatus;
  operationalStatus?: OperationalStatus;
}

export type StatusViolation = 'NOT_READY_FOR_MARKET' | 'OWNER_USE_WITH_RENTAL_MODE' | 'BROKER_STAGE_LIMIT' | 'NO_CHANGES';

/** Стадии, которые брокер может выставлять сам; договорные стадии — только коммерческий менеджер (BR-P11). */
export const BROKER_ALLOWED_COMMERCIAL: readonly CommercialStatus[] = ['AVAILABLE', 'VIEWING', 'NEGOTIATION', 'RESERVED'];

/**
 * Проверка результата применения patch к текущим полям. Чистая функция:
 * возвращает список нарушений; сервис превращает их в ValidationError.
 * `override` — явное разрешение вывести неготовый юнит на рынок (право unit.status.override + reason).
 */
export function validateStatusPatch(
  current: UnitStatusFields,
  patch: StatusPatch,
  opts: { override?: boolean; brokerOnly?: boolean } = {},
): StatusViolation[] {
  const next = { ...current, ...patch };
  const violations: StatusViolation[] = [];
  const changed = (Object.keys(patch) as (keyof StatusPatch)[]).some((k) => patch[k] !== undefined && patch[k] !== current[k]);
  if (!changed) violations.push('NO_CHANGES');
  if (next.readiness !== 'READY' && next.commercialStatus === 'AVAILABLE' && !opts.override) {
    violations.push('NOT_READY_FOR_MARKET');
  }
  if (next.occupancy === 'OWNER_USE' && next.rentalMode !== 'NONE') violations.push('OWNER_USE_WITH_RENTAL_MODE');
  if (opts.brokerOnly && patch.commercialStatus && !BROKER_ALLOWED_COMMERCIAL.includes(patch.commercialStatus)) {
    violations.push('BROKER_STAGE_LIMIT');
  }
  return violations;
}

// ── Фильтры (единый предикат для backend и UI, BR-P12) ──

export interface UnitFilter {
  buildingId?: string;
  floorId?: string;
  color?: UnitColor;
  rentalMode?: RentalMode;
  readiness?: ReadinessStatus;
  occupancy?: OccupancyStatus;
  commercialStatus?: CommercialStatus;
  /** Готов, но пустует дольше N дней. */
  vacantOverDays?: number;
  /** Договор заканчивается в ближайшие N дней. */
  leaseEndsWithinDays?: number;
  managedOnly?: boolean;
  withAlerts?: boolean;
  /** Есть непогашенные начисления аренды (blueprint §1.8 «юниты c задолженностью»). */
  withDebt?: boolean;
  /** Поиск по номеру юнита / собственнику / арендатору (без учёта регистра). */
  q?: string;
}

export interface FilterableUnit extends UnitStatusFields {
  id: string;
  buildingId: string;
  floorId: string;
  unitNo: string;
  managedByPlatform: boolean;
  ownerName?: string | null;
  occupantName?: string | null;
  /** Остаток по начислениям аренды; undefined — нет данных/права. */
  outstandingMinor?: bigint | null;
}

export function matchesUnitFilter(u: FilterableUnit, view: UnitView, f: UnitFilter): boolean {
  if (f.buildingId && u.buildingId !== f.buildingId) return false;
  if (f.floorId && u.floorId !== f.floorId) return false;
  if (f.color && view.color !== f.color) return false;
  if (f.rentalMode && u.rentalMode !== f.rentalMode) return false;
  if (f.readiness && u.readiness !== f.readiness) return false;
  if (f.occupancy && u.occupancy !== f.occupancy) return false;
  if (f.commercialStatus && u.commercialStatus !== f.commercialStatus) return false;
  if (f.vacantOverDays !== undefined) {
    if (u.readiness !== 'READY' || view.vacantDays === null || view.vacantDays < f.vacantOverDays) return false;
  }
  if (f.leaseEndsWithinDays !== undefined) {
    if (view.leaseEndsInDays === null || view.leaseEndsInDays < 0 || view.leaseEndsInDays > f.leaseEndsWithinDays) return false;
  }
  if (f.managedOnly && !u.managedByPlatform) return false;
  if (f.withAlerts && view.alerts.length === 0) return false;
  if (f.withDebt && !(u.outstandingMinor && u.outstandingMinor > 0n)) return false;
  if (f.q) {
    const q = f.q.trim().toLowerCase();
    if (q) {
      const hay = [u.unitNo, u.ownerName ?? '', u.occupantName ?? ''].join('\u0000').toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  return true;
}

// ── Агрегаты KPI strip (BR-P02: технические зоны вне коммерческой статистики) ──

export interface UnitKpiInput extends UnitStatusFields {
  areaM2: number;
  askingRateMinor?: bigint | null;
  monthlyRentMinor?: bigint | null;
}

export interface UnitKpi {
  total: number;
  commercial: number;
  occupied: number;
  vacant: number;
  renovation: number;
  ltr: number;
  str: number;
  ownerUse: number;
  sellable: number;
  withAlerts: number;
  /** Площадь готовых свободных коммерческих юнитов, м² × 100 (целое). */
  availableGlaCm2: number;
  /** Потенциальный месячный доход свободных юнитов по asking rate. */
  potentialIncomeMinor: bigint;
  /** Текущий месячный доход по занятым юнитам (по договорной ставке). */
  currentIncomeMinor: bigint;
  /** Физическая загрузка: занято / коммерческие готовые, в процентах. */
  occupancyPct: number;
}

export function computeUnitKpi(units: UnitKpiInput[], today: Date = new Date()): UnitKpi {
  const k: UnitKpi = {
    total: units.length, commercial: 0, occupied: 0, vacant: 0, renovation: 0, ltr: 0, str: 0, ownerUse: 0,
    sellable: 0, withAlerts: 0, availableGlaCm2: 0, potentialIncomeMinor: 0n, currentIncomeMinor: 0n, occupancyPct: 0,
  };
  let readyCommercial = 0;
  for (const u of units) {
    const v = deriveUnitView(u, today);
    if (!v.isCommercial) continue;
    k.commercial++;
    if (v.alerts.length) k.withAlerts++;
    if (v.color === 'GREY') { k.renovation++; continue; }
    readyCommercial++;
    if (v.color === 'RED') {
      k.vacant++;
      k.availableGlaCm2 += Math.round(u.areaM2 * 100);
      if (u.askingRateMinor) k.potentialIncomeMinor += u.askingRateMinor;
    } else if (v.color === 'GREEN' || v.color === 'YELLOW') {
      k.occupied++;
      if (v.color === 'GREEN') k.ltr++; else k.str++;
      if (u.monthlyRentMinor) k.currentIncomeMinor += u.monthlyRentMinor;
    } else if (v.color === 'BLUE') {
      k.ownerUse++;
    }
    if (v.isSellable) k.sellable++;
  }
  k.occupancyPct = readyCommercial > 0 ? Math.round(((k.occupied + k.ownerUse) / readyCommercial) * 100) : 0;
  return k;
}
