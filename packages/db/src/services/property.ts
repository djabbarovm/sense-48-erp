/**
 * MDS Property — Property Core + Live Building (docs/20 §4–§7).
 * Все чтения tenant-scoped (BR-073), все мутации через withAudit (BR-070),
 * цвет/alert'ы считаются в core (BR-P01), фильтр — единый предикат core (BR-P12).
 */
import type { TenantContext, UnitFilter, UnitKpi, UnitView, StatusPatch } from '@finance-os/core';
import {
  NotFoundError,
  ValidationError,
  can,
  computeUnitKpi,
  deriveUnitView,
  hasRole,
  matchesUnitFilter,
  requirePermission,
  validateStatusPatch,
} from '@finance-os/core';
import type { Building, BuildingKind, ChangeSource, Floor, PropertyOwner, Unit, UnitActivityKind, UnitType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';

type UnitWithOwner = Unit & { owner: PropertyOwner | null };

export interface UnitRow {
  id: string;
  buildingId: string;
  floorId: string;
  unitNo: string;
  type: UnitType;
  areaM2: number;
  geometry: { points: [number, number][] } | null;
  ownerName: string | null;
  occupantName: string | null;
  managedByPlatform: boolean;
  publishedAt: Date | null;
  askingRateMinor: bigint | null;
  askingCurrency: string;
  monthlyRentMinor: bigint | null;
  leaseEndsAt: Date | null;
  vacantSince: Date | null;
  readiness: Unit['readiness'];
  occupancy: Unit['occupancy'];
  rentalMode: Unit['rentalMode'];
  leaseStatus: Unit['leaseStatus'];
  commercialStatus: Unit['commercialStatus'];
  operationalStatus: Unit['operationalStatus'];
  view: UnitView;
}

const STATUS_FIELDS = ['readiness', 'occupancy', 'rentalMode', 'leaseStatus', 'commercialStatus', 'operationalStatus'] as const;

/** BR-P13: имя собственника без права unit.owner.view сокращается до инициалов, контакты не отдаются. */
export function maskOwnerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? '';
  return parts.length > 1 ? `${first} ${parts.slice(1).map((p) => `${p[0] ?? ''}.`).join(' ')}` : first;
}

function toRow(u: UnitWithOwner, ctx: TenantContext, today: Date): UnitRow {
  const showOwner = can(ctx, 'unit.owner.view');
  const showFinance = can(ctx, 'unit.finance.view');
  const ownerName = u.owner ? (showOwner ? u.owner.displayName : maskOwnerName(u.owner.displayName)) : null;
  return {
    id: u.id,
    buildingId: u.buildingId,
    floorId: u.floorId,
    unitNo: u.unitNo,
    type: u.type,
    areaM2: Number(u.areaM2),
    geometry: (u.geometry as { points: [number, number][] } | null) ?? null,
    ownerName,
    occupantName: u.occupantName,
    managedByPlatform: u.managedByPlatform,
    publishedAt: u.publishedAt,
    askingRateMinor: u.askingRateMinor,
    askingCurrency: u.askingCurrency,
    monthlyRentMinor: showFinance ? u.monthlyRentMinor : null,
    leaseEndsAt: u.leaseEndsAt,
    vacantSince: u.vacantSince,
    readiness: u.readiness,
    occupancy: u.occupancy,
    rentalMode: u.rentalMode,
    leaseStatus: u.leaseStatus,
    commercialStatus: u.commercialStatus,
    operationalStatus: u.operationalStatus,
    view: deriveUnitView(u, today),
  };
}

async function loadUnits(ctx: TenantContext, where: Prisma.UnitWhereInput = {}): Promise<UnitWithOwner[]> {
  return prisma.unit.findMany({ where: whereTenant(ctx, where), include: { owner: true }, orderBy: [{ floorId: 'asc' }, { unitNo: 'asc' }] });
}

/** Фильтрация в одном месте: и список, и карта, и KPI видят один и тот же набор (BR-P12). */
function applyFilter(units: UnitWithOwner[], ctx: TenantContext, filter: UnitFilter, today: Date): UnitRow[] {
  const rows: UnitRow[] = [];
  for (const u of units) {
    // Поиск идёт по полному имени собственника (сервер), в ответ уходит маскированное
    const full = { ...u, ownerName: u.owner?.displayName ?? null, occupantName: u.occupantName, managedByPlatform: u.managedByPlatform };
    const view = deriveUnitView(u, today);
    if (!matchesUnitFilter(full, view, filter)) continue;
    rows.push(toRow(u, ctx, today));
  }
  return rows;
}

// ── Чтение ──

export async function listBuildings(ctx: TenantContext): Promise<Building[]> {
  requirePermission(ctx, 'property.view');
  return prisma.building.findMany({ where: whereTenant(ctx), orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
}

export interface FloorSummary {
  floor: Floor;
  units: UnitRow[];
  /** Счётчики по цветам для строки этажа в Building View. */
  byColor: Record<UnitView['color'], number>;
}

export interface StatusMap {
  buildings: { building: Building; floors: FloorSummary[]; kpi: UnitKpi }[];
  kpi: UnitKpi;
  matched: number;
}

const emptyByColor = (): Record<UnitView['color'], number> => ({ RED: 0, GREY: 0, GREEN: 0, YELLOW: 0, BLUE: 0, NEUTRAL: 0 });

/** GET /buildings/status-map: здания → этажи (сверху вниз) → юниты c цветом + KPI (blueprint §1.11). */
export async function getStatusMap(ctx: TenantContext, filter: UnitFilter = {}, today = new Date()): Promise<StatusMap> {
  requirePermission(ctx, 'property.view');
  const [buildings, floors, units] = await Promise.all([
    listBuildings(ctx),
    prisma.floor.findMany({ where: whereTenant(ctx), orderBy: { floorNo: 'desc' } }),
    loadUnits(ctx),
  ]);
  const rows = applyFilter(units, ctx, filter, today);
  const byFloor = new Map<string, UnitRow[]>();
  for (const r of rows) byFloor.set(r.floorId, [...(byFloor.get(r.floorId) ?? []), r]);
  const kpiInput = (list: UnitWithOwner[]) => list.map((u) => ({ ...u, areaM2: Number(u.areaM2) }));
  const filteredIds = new Set(rows.map((r) => r.id));
  const out: StatusMap['buildings'] = [];
  for (const b of buildings) {
    if (filter.buildingId && b.id !== filter.buildingId) continue;
    const bFloors = floors.filter((f) => f.buildingId === b.id);
    const summaries: FloorSummary[] = bFloors.map((floor) => {
      const list = byFloor.get(floor.id) ?? [];
      const byColor = emptyByColor();
      for (const r of list) byColor[r.view.color]++;
      return { floor, units: list, byColor };
    });
    out.push({ building: b, floors: summaries, kpi: computeUnitKpi(kpiInput(units.filter((u) => u.buildingId === b.id && filteredIds.has(u.id))), today) });
  }
  return { buildings: out, kpi: computeUnitKpi(kpiInput(units.filter((u) => filteredIds.has(u.id))), today), matched: rows.length };
}

/** Плоский список для таблицы/поиска — тот же фильтр, что и карта. */
export async function listUnits(ctx: TenantContext, filter: UnitFilter = {}, today = new Date()): Promise<UnitRow[]> {
  requirePermission(ctx, 'property.view');
  return applyFilter(await loadUnits(ctx), ctx, filter, today);
}

export async function getFloor(ctx: TenantContext, floorId: string, filter: UnitFilter = {}, today = new Date()) {
  requirePermission(ctx, 'property.view');
  const floor = await findScopedOr404(prisma.floor, ctx, floorId);
  const building = await findScopedOr404(prisma.building, ctx, floor.buildingId);
  const units = applyFilter(await loadUnits(ctx, { floorId }), ctx, { ...filter, floorId }, today);
  const siblings = await prisma.floor.findMany({ where: whereTenant(ctx, { buildingId: floor.buildingId }), orderBy: { floorNo: 'desc' }, select: { id: true, floorNo: true } });
  return { floor, building, units, siblings };
}

export interface UnitCard {
  unit: UnitRow & { notes: string | null; salePriceMinor: bigint | null; minApprovedRateMinor: bigint | null; statusEffectiveAt: Date };
  building: Building;
  floor: Floor;
  owner: { id: string; displayName: string; kind: PropertyOwner['kind']; contactPhone: string | null; contactEmail: string | null; managementConsent: boolean } | null;
  activities: { id: string; kind: UnitActivityKind; note: string; expectedRateMinor: bigint | null; followUpAt: Date | null; actorId: string; happenedAt: Date }[];
  audit: { id: string; action: string; actorId: string | null; at: Date; before: unknown; after: unknown }[];
  auditVisible: boolean;
  permissions: { readiness: boolean; occupancy: boolean; commercial: boolean; operational: boolean; override: boolean; publish: boolean; pricing: boolean; activity: boolean };
}

/** Unit Card c permission-aware полями (blueprint §1.7; BR-P13 PII). */
export async function getUnitCard(ctx: TenantContext, unitId: string, today = new Date()): Promise<UnitCard> {
  requirePermission(ctx, 'property.view');
  const u = await prisma.unit.findFirst({ where: whereTenant(ctx, { id: unitId }), include: { owner: true } });
  if (!u) throw new NotFoundError();
  const [building, floor, activities, audit] = await Promise.all([
    findScopedOr404(prisma.building, ctx, u.buildingId),
    findScopedOr404(prisma.floor, ctx, u.floorId),
    prisma.unitActivity.findMany({ where: whereTenant(ctx, { unitId }), orderBy: { happenedAt: 'desc' }, take: 50 }),
    prisma.auditLog.findMany({ where: { tenantId: ctx.tenantId, objectType: 'unit', objectId: unitId }, orderBy: { seq: 'desc' }, take: 50, select: { id: true, action: true, actorId: true, at: true, before: true, after: true } }),
  ]);
  const showOwner = can(ctx, 'unit.owner.view');
  const showFinance = can(ctx, 'unit.finance.view');
  const row = toRow(u, ctx, today);
  return {
    unit: {
      ...row,
      notes: u.notes,
      salePriceMinor: showFinance ? u.salePriceMinor : null,
      minApprovedRateMinor: can(ctx, 'unit.pricing.edit') ? u.minApprovedRateMinor : null,
      statusEffectiveAt: u.statusEffectiveAt,
    },
    building,
    floor,
    owner: u.owner
      ? {
          id: u.owner.id,
          displayName: showOwner ? u.owner.displayName : maskOwnerName(u.owner.displayName),
          kind: u.owner.kind,
          contactPhone: showOwner ? u.owner.contactPhone : null,
          contactEmail: showOwner ? u.owner.contactEmail : null,
          managementConsent: u.owner.managementConsent,
        }
      : null,
    activities: activities.map((a) => ({ id: a.id, kind: a.kind, note: a.note, expectedRateMinor: a.expectedRateMinor, followUpAt: a.followUpAt, actorId: a.actorId, happenedAt: a.happenedAt })),
    audit: can(ctx, 'audit.view') || can(ctx, 'property.manage') ? audit : [],
    auditVisible: can(ctx, 'audit.view') || can(ctx, 'property.manage'),
    permissions: {
      readiness: can(ctx, 'unit.status.readiness'),
      occupancy: can(ctx, 'unit.status.occupancy'),
      commercial: can(ctx, 'unit.status.commercial'),
      operational: can(ctx, 'unit.status.operational'),
      override: can(ctx, 'unit.status.override'),
      publish: can(ctx, 'unit.publish'),
      pricing: can(ctx, 'unit.pricing.edit'),
      activity: can(ctx, 'unit.activity.create'),
    },
  };
}

// ── Мутации ──

export interface StatusChangeInput extends StatusPatch {
  reason?: string;
  /** Явное разрешение вывести неготовый юнит на рынок (BR-P04): требует unit.status.override + reason. */
  override?: boolean;
  occupantName?: string | null;
  leaseEndsAt?: Date | null;
  monthlyRentMinor?: bigint | null;
  source?: ChangeSource;
}

const PATCH_PERMISSION: Record<(typeof STATUS_FIELDS)[number], 'unit.status.readiness' | 'unit.status.occupancy' | 'unit.status.commercial' | 'unit.status.operational'> = {
  readiness: 'unit.status.readiness',
  occupancy: 'unit.status.occupancy',
  rentalMode: 'unit.status.occupancy',
  leaseStatus: 'unit.status.occupancy',
  commercialStatus: 'unit.status.commercial',
  operationalStatus: 'unit.status.operational',
};

/**
 * PATCH /units/{id}/status: право проверяется на каждое изменяемое поле (blueprint §1.12),
 * противоречия отклоняются (BR-P04/P10/P11), всё в audit c reason (BR-P08).
 */
export async function changeUnitStatus(ctx: TenantContext, unitId: string, input: StatusChangeInput): Promise<Unit> {
  requirePermission(ctx, 'property.view');
  const patch: StatusPatch = {};
  for (const f of STATUS_FIELDS) {
    const v = input[f];
    if (v !== undefined) {
      requirePermission(ctx, PATCH_PERMISSION[f]);
      (patch as Record<string, unknown>)[f] = v;
    }
  }
  if (input.override) {
    requirePermission(ctx, 'unit.status.override');
    if (!input.reason?.trim()) throw new ValidationError('OVERRIDE_REASON_REQUIRED', 'OVERRIDE_REASON_REQUIRED: вывод неготового юнита на рынок требует причины');
  }
  const brokerOnly = hasRole(ctx, 'BROKER') && !hasRole(ctx, 'OWNER', 'COMMERCIAL_MANAGER');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.unit, ctx, unitId);
    // ADR-018: при действующем договоре занятость/режим/договор меняет только договор; при активной сделке — стадия только через сделку
    if (patch.occupancy !== undefined || patch.rentalMode !== undefined || patch.leaseStatus !== undefined || input.occupantName !== undefined || input.leaseEndsAt !== undefined || input.monthlyRentMinor !== undefined) {
      const live = await tx.leaseContract.count({ where: { tenantId: ctx.tenantId, unitId, status: { in: ['ACTIVE', 'EXPIRING'] } } });
      if (live > 0) throw new ValidationError('LEASE_IS_SOURCE', 'LEASE_IS_SOURCE: на юните действует договор аренды — занятость меняется через договор (расторжение/новый договор)');
    }
    if (patch.commercialStatus !== undefined) {
      const activeDeals = await tx.deal.count({ where: { tenantId: ctx.tenantId, unitId, stage: { notIn: ['WON', 'LOST'] } } });
      if (activeDeals > 0) throw new ValidationError('DEAL_IS_SOURCE', 'DEAL_IS_SOURCE: по юниту есть активная сделка — стадия меняется в сделке');
    }
    const extraChanged = input.occupantName !== undefined || input.leaseEndsAt !== undefined || input.monthlyRentMinor !== undefined;
    const violations = validateStatusPatch(before, patch, { override: input.override ?? false, brokerOnly }).filter((v) => !(v === 'NO_CHANGES' && extraChanged));
    if (violations.length) throw new ValidationError(violations[0]!, `${violations.join(', ')}: недопустимое изменение статуса`);
    const now = new Date();
    const nextOccupancy = patch.occupancy ?? before.occupancy;
    const data: Prisma.UnitUpdateInput = {
      ...patch,
      statusEffectiveAt: now,
      updatedBy: ctx.userId,
      ...(input.occupantName !== undefined ? { occupantName: input.occupantName } : {}),
      ...(input.leaseEndsAt !== undefined ? { leaseEndsAt: input.leaseEndsAt } : {}),
      ...(input.monthlyRentMinor !== undefined ? { monthlyRentMinor: input.monthlyRentMinor } : {}),
    };
    // BR-P09: дата начала простоя ставится системой при переходе в VACANT и снимается при выходе из него
    if (patch.occupancy && patch.occupancy !== before.occupancy) {
      data.vacantSince = nextOccupancy === 'VACANT' ? now : null;
      if (nextOccupancy !== 'OCCUPIED') data.occupantName = null;
    }
    // Юнит, снятый c рынка или занятый, не может оставаться опубликованным (BR-P14)
    const nextView = deriveUnitView({ ...before, ...patch }, now);
    if (before.publishedAt && !nextView.isSellable) data.publishedAt = null;
    const after = await tx.unit.update({ where: { id: unitId }, data });
    const pick = (u: Unit) => Object.fromEntries(STATUS_FIELDS.map((f) => [f, u[f]]));
    return {
      result: after,
      audit: {
        action: 'unit.status.change',
        objectType: 'unit',
        objectId: unitId,
        before: { ...pick(before), occupantName: before.occupantName, publishedAt: before.publishedAt },
        after: { ...pick(after), occupantName: after.occupantName, publishedAt: after.publishedAt, reason: input.reason ?? null, override: input.override ?? false, source: input.source ?? 'UI' },
      },
    };
  });
}

export async function updateUnitPricing(
  ctx: TenantContext,
  unitId: string,
  input: { askingRateMinor?: bigint | null; minApprovedRateMinor?: bigint | null; salePriceMinor?: bigint | null; askingCurrency?: string },
): Promise<Unit> {
  requirePermission(ctx, 'unit.pricing.edit');
  if (input.askingCurrency && !/^[A-Z]{3}$/.test(input.askingCurrency)) throw new ValidationError('CURRENCY_INVALID');
  for (const v of [input.askingRateMinor, input.minApprovedRateMinor, input.salePriceMinor]) {
    if (v != null && v < 0n) throw new ValidationError('NEGATIVE_AMOUNT');
  }
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.unit, ctx, unitId);
    const after = await tx.unit.update({
      where: { id: unitId },
      data: {
        ...(input.askingRateMinor !== undefined ? { askingRateMinor: input.askingRateMinor } : {}),
        ...(input.minApprovedRateMinor !== undefined ? { minApprovedRateMinor: input.minApprovedRateMinor } : {}),
        ...(input.salePriceMinor !== undefined ? { salePriceMinor: input.salePriceMinor } : {}),
        ...(input.askingCurrency !== undefined ? { askingCurrency: input.askingCurrency } : {}),
        updatedBy: ctx.userId,
      },
    });
    const pick = (u: Unit) => ({ askingRateMinor: u.askingRateMinor?.toString() ?? null, minApprovedRateMinor: u.minApprovedRateMinor?.toString() ?? null, salePriceMinor: u.salePriceMinor?.toString() ?? null, askingCurrency: u.askingCurrency });
    return { result: after, audit: { action: 'unit.pricing.update', objectType: 'unit', objectId: unitId, before: pick(before), after: pick(after) } };
  });
}

/** BR-P14: публикуется только готовый, свободный юнит на рынке; снятие — всегда. */
export async function setUnitPublished(ctx: TenantContext, unitId: string, published: boolean): Promise<Unit> {
  requirePermission(ctx, 'unit.publish');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.unit, ctx, unitId);
    if (published && !deriveUnitView(before).isSellable) throw new ValidationError('NOT_SELLABLE', 'NOT_SELLABLE: публиковать можно только готовый свободный юнит на рынке');
    const after = await tx.unit.update({ where: { id: unitId }, data: { publishedAt: published ? new Date() : null, updatedBy: ctx.userId } });
    return {
      result: after,
      audit: { action: published ? 'unit.publish' : 'unit.unpublish', objectType: 'unit', objectId: unitId, before: { publishedAt: before.publishedAt }, after: { publishedAt: after.publishedAt } },
    };
  });
}

export async function addUnitActivity(
  ctx: TenantContext,
  unitId: string,
  input: { kind: UnitActivityKind; note: string; expectedRateMinor?: bigint | null; followUpAt?: Date | null; source?: ChangeSource },
) {
  requirePermission(ctx, 'unit.activity.create');
  if (!input.note.trim()) throw new ValidationError('NOTE_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    await findScopedOr404(tx.unit, ctx, unitId);
    const created = await tx.unitActivity.create({
      data: {
        tenantId: ctx.tenantId,
        unitId,
        kind: input.kind,
        note: input.note.trim(),
        expectedRateMinor: input.expectedRateMinor ?? null,
        followUpAt: input.followUpAt ?? null,
        source: input.source ?? 'UI',
        actorId: ctx.userId,
      },
    });
    return {
      result: created,
      audit: { action: 'unit.activity.create', objectType: 'unit', objectId: unitId, after: { activityId: created.id, kind: created.kind, expectedRateMinor: created.expectedRateMinor?.toString() ?? null } },
    };
  });
}

// ── Master data (property.manage) ──

export async function createBuilding(ctx: TenantContext, input: { code: string; name: string; kind: BuildingKind; address?: string | null; sortOrder?: number }): Promise<Building> {
  requirePermission(ctx, 'property.manage');
  if (!input.code.trim() || !input.name.trim()) throw new ValidationError('REQUIRED_FIELDS');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const created = await tx.building.create({ data: { tenantId: ctx.tenantId, code: input.code.trim().toUpperCase(), name: input.name.trim(), kind: input.kind, address: input.address ?? null, sortOrder: input.sortOrder ?? 0 } });
    return { result: created, audit: { action: 'building.create', objectType: 'building', objectId: created.id, after: { code: created.code, name: created.name, kind: created.kind } } };
  });
}

export async function createFloor(ctx: TenantContext, input: { buildingId: string; floorNo: number; name?: string | null; planViewBox?: string }): Promise<Floor> {
  requirePermission(ctx, 'property.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    await findScopedOr404(tx.building, ctx, input.buildingId);
    const created = await tx.floor.create({ data: { tenantId: ctx.tenantId, buildingId: input.buildingId, floorNo: input.floorNo, name: input.name ?? null, ...(input.planViewBox ? { planViewBox: input.planViewBox } : {}) } });
    return { result: created, audit: { action: 'floor.create', objectType: 'floor', objectId: created.id, after: { buildingId: created.buildingId, floorNo: created.floorNo } } };
  });
}

export interface UnitInput {
  floorId: string;
  unitNo: string;
  type: UnitType;
  areaM2: number;
  geometry?: { points: [number, number][] } | null;
  ownerId?: string | null;
  managedByPlatform?: boolean;
  askingRateMinor?: bigint | null;
  notes?: string | null;
}

export async function createUnit(ctx: TenantContext, input: UnitInput): Promise<Unit> {
  requirePermission(ctx, 'property.manage');
  if (!input.unitNo.trim()) throw new ValidationError('UNIT_NO_REQUIRED');
  if (!(input.areaM2 > 0)) throw new ValidationError('AREA_INVALID');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const floor = await findScopedOr404(tx.floor, ctx, input.floorId);
    if (input.ownerId) await findScopedOr404(tx.propertyOwner, ctx, input.ownerId);
    const created = await tx.unit.create({
      data: {
        tenantId: ctx.tenantId,
        buildingId: floor.buildingId,
        floorId: floor.id,
        unitNo: input.unitNo.trim(),
        type: input.type,
        areaM2: new Prisma.Decimal(input.areaM2.toFixed(2)),
        geometry: input.geometry ? (input.geometry as Prisma.InputJsonValue) : Prisma.DbNull,
        ownerId: input.ownerId ?? null,
        managedByPlatform: input.managedByPlatform ?? false,
        askingRateMinor: input.askingRateMinor ?? null,
        notes: input.notes ?? null,
        vacantSince: new Date(),
        createdBy: ctx.userId,
      },
    });
    return { result: created, audit: { action: 'unit.create', objectType: 'unit', objectId: created.id, after: { unitNo: created.unitNo, type: created.type, areaM2: created.areaM2.toString(), floorId: created.floorId } } };
  });
}

/** BR-P15: unit_no неизменяем после создания — это ключ связи c внешними системами. */
export async function updateUnit(ctx: TenantContext, unitId: string, input: Partial<Omit<UnitInput, 'floorId' | 'unitNo'>> & { unitNo?: string }): Promise<Unit> {
  requirePermission(ctx, 'property.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.unit, ctx, unitId);
    if (input.unitNo !== undefined && input.unitNo !== before.unitNo) throw new ValidationError('UNIT_NO_IMMUTABLE', 'UNIT_NO_IMMUTABLE: Unit ID нельзя менять после создания (BR-P15)');
    if (input.ownerId) await findScopedOr404(tx.propertyOwner, ctx, input.ownerId);
    const after = await tx.unit.update({
      where: { id: unitId },
      data: {
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.areaM2 !== undefined ? { areaM2: new Prisma.Decimal(input.areaM2.toFixed(2)) } : {}),
        ...(input.geometry !== undefined ? { geometry: input.geometry ? (input.geometry as Prisma.InputJsonValue) : Prisma.DbNull } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.managedByPlatform !== undefined ? { managedByPlatform: input.managedByPlatform } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedBy: ctx.userId,
      },
    });
    const pick = (u: Unit) => ({ type: u.type, areaM2: u.areaM2.toString(), ownerId: u.ownerId, managedByPlatform: u.managedByPlatform });
    return { result: after, audit: { action: 'unit.update', objectType: 'unit', objectId: unitId, before: pick(before), after: pick(after) } };
  });
}

export async function createPropertyOwner(ctx: TenantContext, input: { kind: PropertyOwner['kind']; displayName: string; contactPhone?: string | null; contactEmail?: string | null; managementConsent?: boolean; notes?: string | null }): Promise<PropertyOwner> {
  requirePermission(ctx, 'property.manage');
  if (!input.displayName.trim()) throw new ValidationError('REQUIRED_FIELDS');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const created = await tx.propertyOwner.create({
      data: { tenantId: ctx.tenantId, kind: input.kind, displayName: input.displayName.trim(), contactPhone: input.contactPhone ?? null, contactEmail: input.contactEmail ?? null, managementConsent: input.managementConsent ?? false, notes: input.notes ?? null },
    });
    // Контакты в audit не пишем — PII (docs/11)
    return { result: created, audit: { action: 'property_owner.create', objectType: 'property_owner', objectId: created.id, after: { displayName: created.displayName, kind: created.kind, managementConsent: created.managementConsent } } };
  });
}

export async function listPropertyOwners(ctx: TenantContext) {
  requirePermission(ctx, 'property.view');
  const showOwner = can(ctx, 'unit.owner.view');
  const rows = await prisma.propertyOwner.findMany({ where: whereTenant(ctx), orderBy: { displayName: 'asc' }, include: { _count: { select: { units: true } } } });
  return rows.map((o) => ({
    id: o.id,
    kind: o.kind,
    displayName: showOwner ? o.displayName : maskOwnerName(o.displayName),
    contactPhone: showOwner ? o.contactPhone : null,
    contactEmail: showOwner ? o.contactEmail : null,
    managementConsent: o.managementConsent,
    unitsCount: o._count.units,
  }));
}
