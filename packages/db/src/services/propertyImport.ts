/**
 * P-07/P-08: импорт инвентаря (inventory.xlsx) и геометрии этажей (JSON/SVG) для MDS Property.
 * All-or-nothing на файл: полная валидация → одна транзакция → audit (BR-P08).
 * Unit ID неизменяем: существующие юниты пропускаются, не перезаписываются (BR-P15).
 */
import type { TenantContext } from '@finance-os/core';
import {
  COMMERCIAL_STATUSES,
  LEASE_STATUSES,
  OCCUPANCY_STATUSES,
  READINESS_STATUSES,
  RENTAL_MODES,
  UNIT_TYPES,
  ValidationError,
  parseDecimalToMinor,
  requirePermission,
  validateStatusPatch,
} from '@finance-os/core';
import type { BuildingKind, CommercialStatus, LeaseStatus, OccupancyStatus, PropertyOwnerKind, ReadinessStatus, RentalMode, UnitType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import type { MigrationReport } from './migration.js';

type Row = Record<string, string>;
const BUILDING_KINDS = ['TOWER', 'OFFICES', 'MALL', 'MIXED'] as const;
const OWNER_KINDS = ['PERSON', 'COMPANY'] as const;

class RowErrors {
  readonly errors: MigrationReport['errors'] = [];
  add(row: number, field: string, message: string) {
    this.errors.push({ row: row + 2, field, message });
  }
}

const yn = (v: string) => /^(y|yes|да|1|true)$/i.test(v.trim());
const oneOf = <T extends string>(v: string, list: readonly T[]): T | undefined => (v && (list as readonly string[]).includes(v.trim().toUpperCase()) ? (v.trim().toUpperCase() as T) : undefined);

function parseDateStr(value: string): Date | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(value);
  const dot = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dot) return new Date(`${dot[3]}-${dot[2]!.padStart(2, '0')}-${dot[1]!.padStart(2, '0')}`);
  return null;
}

function parseMoney(value: string): bigint | null {
  try {
    return parseDecimalToMinor(value.replace(/[\s\u00a0]/g, '').replace(',', '.'));
  } catch {
    return null;
  }
}

interface ParsedUnit {
  row: number;
  buildingCode: string;
  buildingName: string;
  buildingKind: BuildingKind | undefined;
  floorNo: number;
  unitNo: string;
  type: UnitType;
  areaM2: number;
  ownerName: string;
  ownerKind: PropertyOwnerKind;
  ownerPhone: string | null;
  ownerEmail: string | null;
  managementConsent: boolean;
  managedByPlatform: boolean;
  readiness: ReadinessStatus;
  occupancy: OccupancyStatus;
  rentalMode: RentalMode;
  leaseStatus: LeaseStatus;
  commercialStatus: CommercialStatus;
  occupantName: string | null;
  leaseEndsAt: Date | null;
  askingRateMinor: bigint | null;
  currency: string;
  monthlyRentMinor: bigint | null;
}

export async function importInventoryXlsx(ctx: TenantContext, rows: Row[]): Promise<MigrationReport> {
  requirePermission(ctx, 'property.manage');
  const report: MigrationReport = { total: rows.length, imported: 0, skipped: 0, errors: [] };
  const errors = new RowErrors();

  const existingBuildings = new Map((await prisma.building.findMany({ where: whereTenant(ctx) })).map((b) => [b.code, b]));
  const seenInFile = new Set<string>();
  const buildingMeta = new Map<string, { name: string; kind: BuildingKind }>();
  const parsed: ParsedUnit[] = [];

  rows.forEach((r, i) => {
    const g = (k: string) => (r[k] ?? '').trim();
    const buildingCode = g('building_code').toUpperCase();
    if (!buildingCode) errors.add(i, 'building_code', 'обязательно');
    const buildingKind = oneOf(g('building_kind'), BUILDING_KINDS);
    if (buildingCode && !existingBuildings.has(buildingCode) && !buildingMeta.has(buildingCode)) {
      if (!g('building_name')) errors.add(i, 'building_name', 'обязательно при первом появлении здания');
      if (!buildingKind) errors.add(i, 'building_kind', `первое появление здания: TOWER/OFFICES/MALL/MIXED`);
      if (g('building_name') && buildingKind) buildingMeta.set(buildingCode, { name: g('building_name'), kind: buildingKind });
    }
    const floorNo = Number(g('floor_no'));
    if (!g('floor_no') || !Number.isInteger(floorNo)) errors.add(i, 'floor_no', 'целое число');
    const unitNo = g('unit_no');
    if (!unitNo) errors.add(i, 'unit_no', 'обязательно');
    const key = `${buildingCode}\u0000${unitNo}`;
    if (unitNo && seenInFile.has(key)) errors.add(i, 'unit_no', 'дубликат в файле');
    seenInFile.add(key);
    const type = oneOf(g('unit_type'), UNIT_TYPES);
    if (!type) errors.add(i, 'unit_type', UNIT_TYPES.join('/'));
    const areaM2 = Number(g('area_m2').replace(',', '.'));
    if (!(areaM2 > 0)) errors.add(i, 'area_m2', 'число > 0');
    const ownerKind = oneOf(g('owner_kind') || 'PERSON', OWNER_KINDS);
    if (!ownerKind) errors.add(i, 'owner_kind', 'PERSON/COMPANY');
    const readiness = oneOf(g('readiness') || 'READY', READINESS_STATUSES);
    if (!readiness) errors.add(i, 'readiness', READINESS_STATUSES.join('/'));
    const occupancy = oneOf(g('occupancy') || 'VACANT', OCCUPANCY_STATUSES);
    if (!occupancy) errors.add(i, 'occupancy', OCCUPANCY_STATUSES.join('/'));
    const rentalMode = oneOf(g('rental_mode') || 'NONE', RENTAL_MODES);
    if (!rentalMode) errors.add(i, 'rental_mode', RENTAL_MODES.join('/'));
    const leaseStatus = oneOf(g('lease_status') || 'NONE', LEASE_STATUSES);
    if (!leaseStatus) errors.add(i, 'lease_status', LEASE_STATUSES.join('/'));
    const commercialStatus = oneOf(g('commercial_status') || 'OFF_MARKET', COMMERCIAL_STATUSES);
    if (!commercialStatus) errors.add(i, 'commercial_status', COMMERCIAL_STATUSES.join('/'));
    const leaseEndsAt = g('lease_ends_at') ? parseDateStr(g('lease_ends_at')) : null;
    if (g('lease_ends_at') && !leaseEndsAt) errors.add(i, 'lease_ends_at', 'дата ГГГГ-ММ-ДД');
    const askingRateMinor = g('asking_rate') ? parseMoney(g('asking_rate')) : null;
    if (g('asking_rate') && askingRateMinor === null) errors.add(i, 'asking_rate', 'сумма');
    const monthlyRentMinor = g('monthly_rent') ? parseMoney(g('monthly_rent')) : null;
    if (g('monthly_rent') && monthlyRentMinor === null) errors.add(i, 'monthly_rent', 'сумма');
    const currency = (g('currency') || 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) errors.add(i, 'currency', 'код ISO, например USD');
    if (g('owner_email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(g('owner_email'))) errors.add(i, 'owner_email', 'email');

    // Жёсткие правила статусов — как в changeUnitStatus (BR-P04/P10); прочие противоречия → alert
    if (type && readiness && occupancy && rentalMode && leaseStatus && commercialStatus) {
      const base = { type, readiness: 'READY' as const, occupancy: 'VACANT' as const, rentalMode: 'NONE' as const, leaseStatus: 'NONE' as const, commercialStatus: 'OFF_MARKET' as const, operationalStatus: 'NORMAL' as const };
      const violations = validateStatusPatch(base, { readiness, occupancy, rentalMode, leaseStatus, commercialStatus }).filter((v) => v !== 'NO_CHANGES');
      for (const v of violations) errors.add(i, 'commercial_status', v === 'NOT_READY_FOR_MARKET' ? 'неготовый юнит нельзя выставить AVAILABLE (BR-P04)' : v === 'OWNER_USE_WITH_RENTAL_MODE' ? 'OWNER_USE несовместим c rental_mode (BR-P10)' : v);
    }

    if (buildingCode && unitNo && type && readiness && occupancy && rentalMode && leaseStatus && commercialStatus && ownerKind && Number.isInteger(floorNo) && areaM2 > 0) {
      parsed.push({
        row: i, buildingCode, buildingName: g('building_name'), buildingKind, floorNo, unitNo, type, areaM2: Math.round(areaM2 * 100) / 100,
        ownerName: g('owner_name'), ownerKind, ownerPhone: g('owner_phone') || null, ownerEmail: g('owner_email') || null,
        managementConsent: yn(g('management_consent')), managedByPlatform: yn(g('managed_by_platform')),
        readiness, occupancy, rentalMode, leaseStatus, commercialStatus, occupantName: g('occupant_name') || null, leaseEndsAt,
        askingRateMinor, currency, monthlyRentMinor,
      });
    }
  });

  report.errors = errors.errors;
  if (report.errors.length > 0) return report; // all-or-nothing

  const existingUnits = new Set((await prisma.unit.findMany({ where: whereTenant(ctx), select: { unitNo: true, building: { select: { code: true } } } })).map((u) => `${u.building.code}\u0000${u.unitNo}`));
  const toCreate = parsed.filter((p) => !existingUnits.has(`${p.buildingCode}\u0000${p.unitNo}`));
  report.skipped = parsed.length - toCreate.length;
  if (toCreate.length === 0) return report;

  await withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const buildingIds = new Map<string, string>();
    for (const [code, b] of existingBuildings) buildingIds.set(code, b.id);
    const audit: { action: string; objectType: string; objectId: string; after: Record<string, unknown> }[] = [];
    let sortOrder = existingBuildings.size;
    for (const [code, meta] of buildingMeta) {
      if (buildingIds.has(code)) continue;
      const b = await tx.building.create({ data: { tenantId: ctx.tenantId, code, name: meta.name, kind: meta.kind, sortOrder: ++sortOrder } });
      buildingIds.set(code, b.id);
      audit.push({ action: 'building.create', objectType: 'building', objectId: b.id, after: { code, name: meta.name, kind: meta.kind, source: 'IMPORT' } });
    }
    const floorIds = new Map<string, string>();
    const owners = new Map<string, string>();
    for (const o of await tx.propertyOwner.findMany({ where: whereTenant(ctx), select: { id: true, displayName: true } })) owners.set(o.displayName.trim().toLowerCase(), o.id);
    const now = new Date();
    for (const p of toCreate) {
      const buildingId = buildingIds.get(p.buildingCode)!;
      const fKey = `${buildingId}:${p.floorNo}`;
      let floorId = floorIds.get(fKey);
      if (!floorId) {
        const f = await tx.floor.upsert({ where: { buildingId_floorNo: { buildingId, floorNo: p.floorNo } }, create: { tenantId: ctx.tenantId, buildingId, floorNo: p.floorNo }, update: {} });
        floorId = f.id;
        floorIds.set(fKey, floorId);
      }
      let ownerId: string | null = null;
      if (p.ownerName) {
        const k = p.ownerName.trim().toLowerCase();
        ownerId = owners.get(k) ?? null;
        if (!ownerId) {
          const o = await tx.propertyOwner.create({ data: { tenantId: ctx.tenantId, kind: p.ownerKind, displayName: p.ownerName.trim(), contactPhone: p.ownerPhone, contactEmail: p.ownerEmail, managementConsent: p.managementConsent } });
          ownerId = o.id;
          owners.set(k, ownerId);
          audit.push({ action: 'property_owner.create', objectType: 'property_owner', objectId: o.id, after: { displayName: o.displayName, kind: o.kind, source: 'IMPORT' } });
        }
      }
      const u = await tx.unit.create({
        data: {
          tenantId: ctx.tenantId, buildingId, floorId, unitNo: p.unitNo, type: p.type, areaM2: new Prisma.Decimal(p.areaM2.toFixed(2)),
          ownerId, occupantName: p.occupancy === 'OCCUPIED' ? p.occupantName : null,
          readiness: p.readiness, occupancy: p.occupancy, rentalMode: p.rentalMode, leaseStatus: p.leaseStatus, commercialStatus: p.commercialStatus,
          statusEffectiveAt: now, vacantSince: p.occupancy === 'VACANT' ? now : null, leaseEndsAt: p.leaseEndsAt,
          askingCurrency: p.currency, askingRateMinor: p.askingRateMinor, monthlyRentMinor: p.monthlyRentMinor, managedByPlatform: p.managedByPlatform,
          createdBy: ctx.userId,
        },
      });
      audit.push({ action: 'unit.create', objectType: 'unit', objectId: u.id, after: { unitNo: u.unitNo, type: u.type, areaM2: p.areaM2, buildingCode: p.buildingCode, floorNo: p.floorNo, source: 'IMPORT' } });
      report.imported++;
    }
    return { result: undefined, audit };
  });
  return report;
}

export interface FloorPlanImportInput {
  buildingCode: string;
  floorNo: number;
  viewBox: string;
  units: Record<string, [number, number][]>;
}

export interface FloorPlanReport {
  floorId: string;
  geometryVersion: number;
  updated: number;
  errors: { unitNo: string; message: string }[];
}

/** BR-P16: геометрия только для существующих юнитов этажа; неизвестный unit_no → отказ файла; версия этажа растёт. */
export async function importFloorPlan(ctx: TenantContext, input: FloorPlanImportInput): Promise<FloorPlanReport> {
  requirePermission(ctx, 'property.manage');
  const building = await prisma.building.findFirst({ where: whereTenant(ctx, { code: input.buildingCode.trim().toUpperCase() }) });
  if (!building) throw new ValidationError('BUILDING_NOT_FOUND', `BUILDING_NOT_FOUND: здание ${input.buildingCode} не найдено`);
  const floor = await prisma.floor.findFirst({ where: whereTenant(ctx, { buildingId: building.id, floorNo: input.floorNo }) });
  if (!floor) throw new ValidationError('FLOOR_NOT_FOUND', `FLOOR_NOT_FOUND: этаж ${input.floorNo} не найден`);
  if (!/^-?\d+(\.\d+)?(\s+-?\d+(\.\d+)?){3}$/.test(input.viewBox.trim())) throw new ValidationError('VIEWBOX_INVALID');
  const units = await prisma.unit.findMany({ where: whereTenant(ctx, { floorId: floor.id }), select: { id: true, unitNo: true } });
  const byNo = new Map(units.map((u) => [u.unitNo, u.id]));
  const errors: FloorPlanReport['errors'] = [];
  for (const [unitNo, pts] of Object.entries(input.units)) {
    if (!byNo.has(unitNo)) errors.push({ unitNo, message: 'юнит не найден на этом этаже' });
    else if (pts.length < 3) errors.push({ unitNo, message: 'полигон из < 3 точек' });
  }
  if (Object.keys(input.units).length === 0) errors.push({ unitNo: '*', message: 'в файле нет полигонов' });
  if (errors.length) return { floorId: floor.id, geometryVersion: floor.geometryVersion, updated: 0, errors };

  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    await findScopedOr404(tx.floor, ctx, floor.id);
    for (const [unitNo, pts] of Object.entries(input.units)) {
      await tx.unit.update({ where: { id: byNo.get(unitNo)! }, data: { geometry: { points: pts } as Prisma.InputJsonValue, updatedBy: ctx.userId } });
    }
    const after = await tx.floor.update({ where: { id: floor.id }, data: { planViewBox: input.viewBox.trim(), geometryVersion: { increment: 1 } } });
    return {
      result: { floorId: floor.id, geometryVersion: after.geometryVersion, updated: Object.keys(input.units).length, errors: [] },
      audit: {
        action: 'floor.geometry.import',
        objectType: 'floor',
        objectId: floor.id,
        before: { geometryVersion: floor.geometryVersion, planViewBox: floor.planViewBox },
        after: { geometryVersion: after.geometryVersion, planViewBox: after.planViewBox, units: Object.keys(input.units).length, source: 'IMPORT' },
      },
    };
  });
}
