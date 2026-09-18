import type { UnitFilter } from '@finance-os/core';
import { COMMERCIAL_STATUSES, OCCUPANCY_STATUSES, READINESS_STATUSES, RENTAL_MODES, UNIT_COLORS } from '@finance-os/core';

export type PropertySearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v) || undefined;
const inList = <T extends string>(v: string | undefined, list: readonly T[]): T | undefined => (v && (list as readonly string[]).includes(v) ? (v as T) : undefined);
const days = (v: string | undefined): number | undefined => (v && ['30', '60', '90'].includes(v) ? Number(v) : undefined);

/** URL → UnitFilter. Один парсер для карты, этажа и списка (BR-P12). */
export function parseUnitFilter(sp: PropertySearchParams): UnitFilter {
  const f: UnitFilter = {};
  const building = one(sp.building);
  const floor = one(sp.floor);
  const color = inList(one(sp.color), UNIT_COLORS);
  const mode = inList(one(sp.mode), RENTAL_MODES);
  const readiness = inList(one(sp.readiness), READINESS_STATUSES);
  const occupancy = inList(one(sp.occupancy), OCCUPANCY_STATUSES);
  const commercial = inList(one(sp.commercial), COMMERCIAL_STATUSES);
  const vacant = days(one(sp.vacant));
  const expiring = days(one(sp.expiring));
  const q = one(sp.q);
  if (building) f.buildingId = building;
  if (floor) f.floorId = floor;
  if (color) f.color = color;
  if (mode) f.rentalMode = mode;
  if (readiness) f.readiness = readiness;
  if (occupancy) f.occupancy = occupancy;
  if (commercial) f.commercialStatus = commercial;
  if (vacant) f.vacantOverDays = vacant;
  if (expiring) f.leaseEndsWithinDays = expiring;
  if (one(sp.managed) === '1') f.managedOnly = true;
  if (one(sp.alerts) === '1') f.withAlerts = true;
  if (q) f.q = q;
  return f;
}

/** Сохраняет активные параметры фильтра при переходе между экранами. */
export function filterQuery(sp: PropertySearchParams, patch: Record<string, string | null> = {}): string {
  const keep = ['building', 'floor', 'color', 'mode', 'readiness', 'occupancy', 'commercial', 'vacant', 'expiring', 'managed', 'alerts', 'q'];
  const params = new URLSearchParams();
  for (const k of keep) {
    const v = k in patch ? patch[k] : one(sp[k]);
    if (v) params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function hasActiveFilter(f: UnitFilter): boolean {
  return Object.keys(f).some((k) => k !== 'buildingId');
}
