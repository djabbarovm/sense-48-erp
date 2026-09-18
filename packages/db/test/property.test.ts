import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, ValidationError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import {
  addUnitActivity,
  changeUnitStatus,
  createBuilding,
  createFloor,
  createPropertyOwner,
  createUnit,
  getFloor,
  getStatusMap,
  getUnitCard,
  listUnits,
  maskOwnerName,
  setUnitPublished,
  updateUnit,
  updateUnitPricing,
} from '../src/services/property.js';

let tenantId: string;
let otherTenantId: string;
const ctx = (...roles: RoleCode[]) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'p', userId: crypto.randomUUID(), roles });
const other = () => unsafeCreateTenantContext({ tenantId: otherTenantId, tenantSlug: 'o', userId: crypto.randomUUID(), roles: ['OWNER'] });

let floorId: string;
let unitId: string;
let ownerId: string;

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { slug: `t-p-${Date.now()}`, legalName: 'P', taxId: '300000021' } })).id;
  otherTenantId = (await prisma.tenant.create({ data: { slug: `t-po-${Date.now()}`, legalName: 'PO', taxId: '300000022' } })).id;
  const b = await createBuilding(ctx('ADMIN'), { code: 'tower', name: 'Tower', kind: 'TOWER' });
  const f = await createFloor(ctx('ADMIN'), { buildingId: b.id, floorNo: 17 });
  floorId = f.id;
  ownerId = (await createPropertyOwner(ctx('COMMERCIAL_MANAGER'), { kind: 'PERSON', displayName: 'Рустам Каримов', contactPhone: '+998901112233', managementConsent: true })).id;
  unitId = (await createUnit(ctx('COMMERCIAL_MANAGER'), { floorId, unitNo: '1704', type: 'APARTMENT', areaM2: 84.5, ownerId, askingRateMinor: 120_000n, geometry: { points: [[0, 0], [100, 0], [100, 80], [0, 80]] } })).id;
  await createUnit(ctx('COMMERCIAL_MANAGER'), { floorId, unitNo: '1705', type: 'APARTMENT', areaM2: 60 });
  await createUnit(ctx('COMMERCIAL_MANAGER'), { floorId, unitNo: 'T17', type: 'TECHNICAL', areaM2: 20 });
});

afterAll(async () => prisma.$disconnect());

describe('MDS Property — Property Core', () => {
  it('BR-P15: unit_no неизменяем; уникален в здании', async () => {
    await expect(updateUnit(ctx('ADMIN'), unitId, { unitNo: '1799' })).rejects.toThrow(/UNIT_NO_IMMUTABLE/);
    await expect(createUnit(ctx('ADMIN'), { floorId, unitNo: '1704', type: 'OFFICE', areaM2: 10 })).rejects.toThrow();
  });

  it('BR-P01: карта здания красит из полей; новый юнит готов и свободен → RED, технический → NEUTRAL и вне KPI', async () => {
    const map = await getStatusMap(ctx('BROKER'));
    expect(map.buildings).toHaveLength(1);
    const fl = map.buildings[0]!.floors[0]!;
    expect(fl.floor.floorNo).toBe(17);
    expect(fl.byColor.RED).toBe(2);
    expect(fl.byColor.NEUTRAL).toBe(1);
    expect(map.kpi.total).toBe(3);
    expect(map.kpi.commercial).toBe(2);
    expect(map.kpi.potentialIncomeMinor).toBe(120_000n);
    expect(map.kpi.availableGlaCm2).toBe(14_450);
  });

  it('403: роль без права не меняет статус; 404: чужой tenant не видит юнит', async () => {
    await expect(changeUnitStatus(ctx('MARKETING'), unitId, { readiness: 'RENOVATION' })).rejects.toThrow(PermissionDeniedError);
    await expect(changeUnitStatus(ctx('OPERATIONS_MANAGER'), unitId, { commercialStatus: 'AVAILABLE' })).rejects.toThrow(PermissionDeniedError);
    await expect(getUnitCard(other(), unitId)).rejects.toThrow(NotFoundError);
    await expect(changeUnitStatus(other(), unitId, { readiness: 'RENOVATION' })).rejects.toThrow(NotFoundError);
    expect(await listUnits(other())).toHaveLength(0);
  });

  it('BR-P04: неготовый юнит нельзя выставить на рынок без override + reason; override пишется в audit', async () => {
    await changeUnitStatus(ctx('OPERATIONS_MANAGER'), unitId, { readiness: 'FITOUT' });
    await expect(changeUnitStatus(ctx('COMMERCIAL_MANAGER'), unitId, { commercialStatus: 'AVAILABLE' })).rejects.toThrow(/NOT_READY_FOR_MARKET/);
    await expect(changeUnitStatus(ctx('COMMERCIAL_MANAGER'), unitId, { commercialStatus: 'AVAILABLE', override: true })).rejects.toThrow(/OVERRIDE_REASON_REQUIRED/);
    await expect(changeUnitStatus(ctx('BROKER'), unitId, { commercialStatus: 'AVAILABLE', override: true, reason: 'x' })).rejects.toThrow(PermissionDeniedError);
    await changeUnitStatus(ctx('COMMERCIAL_MANAGER'), unitId, { commercialStatus: 'AVAILABLE', override: true, reason: 'Показы во время отделки согласованы c собственником' });
    const last = await prisma.auditLog.findFirst({ where: { tenantId, objectId: unitId, action: 'unit.status.change' }, orderBy: { seq: 'desc' } });
    expect((last!.after as { override: boolean; reason: string }).override).toBe(true);
    expect((last!.after as { reason: string }).reason).toMatch(/собственником/);
    const card = await getUnitCard(ctx('COMMERCIAL_MANAGER'), unitId);
    expect(card.unit.view.color).toBe('GREY');
    expect(card.unit.view.alerts).toContain('NOT_READY_BUT_AVAILABLE');
    await changeUnitStatus(ctx('OPERATIONS_MANAGER'), unitId, { readiness: 'READY' });
  });

  it('BR-P11: брокер двигает сделку только до договорных стадий', async () => {
    await changeUnitStatus(ctx('BROKER'), unitId, { commercialStatus: 'NEGOTIATION' });
    await expect(changeUnitStatus(ctx('BROKER'), unitId, { commercialStatus: 'CONTRACTED' })).rejects.toThrow(/BROKER_STAGE_LIMIT/);
    const card = await getUnitCard(ctx('BROKER'), unitId);
    expect(card.unit.view.color).toBe('RED');
    expect(card.unit.view.overlay).toBe('NEGOTIATION');
  });

  it('BR-P09/P14: заселение снимает vacant_since и публикацию; освобождение ставит дату простоя', async () => {
    await changeUnitStatus(ctx('COMMERCIAL_MANAGER'), unitId, { commercialStatus: 'AVAILABLE' });
    await setUnitPublished(ctx('MARKETING'), unitId, true);
    expect((await prisma.unit.findUnique({ where: { id: unitId } }))!.publishedAt).not.toBeNull();
    const occupied = await changeUnitStatus(ctx('COMMERCIAL_MANAGER'), unitId, {
      occupancy: 'OCCUPIED', rentalMode: 'LTR', leaseStatus: 'ACTIVE', commercialStatus: 'CONTRACTED',
      occupantName: 'CityNet LLC', leaseEndsAt: new Date('2027-03-01'), monthlyRentMinor: 110_000n,
    });
    expect(occupied.vacantSince).toBeNull();
    expect(occupied.publishedAt).toBeNull();
    expect(occupied.occupantName).toBe('CityNet LLC');
    const card = await getUnitCard(ctx('OWNER'), unitId);
    expect(card.unit.view.color).toBe('GREEN');
    expect(card.unit.view.alerts).toEqual([]);
    await expect(setUnitPublished(ctx('MARKETING'), unitId, true)).rejects.toThrow(/NOT_SELLABLE/);

    const vacated = await changeUnitStatus(ctx('COMMERCIAL_MANAGER'), unitId, { occupancy: 'VACANT', rentalMode: 'NONE', leaseStatus: 'TERMINATED', commercialStatus: 'AVAILABLE' });
    expect(vacated.vacantSince).not.toBeNull();
    expect(vacated.occupantName).toBeNull();
  });

  it('BR-P10: owner use несовместим c режимом аренды', async () => {
    await expect(changeUnitStatus(ctx('OWNER'), unitId, { occupancy: 'OWNER_USE', rentalMode: 'STR' })).rejects.toThrow(/OWNER_USE_WITH_RENTAL_MODE/);
  });

  it('BR-P12: фильтры карты, списка и этажа возвращают один и тот же набор', async () => {
    await changeUnitStatus(ctx('COMMERCIAL_MANAGER'), unitId, { occupancy: 'OCCUPIED', rentalMode: 'STR', commercialStatus: 'OFF_MARKET' });
    const filter = { color: 'YELLOW' as const };
    const [map, list, floor] = await Promise.all([getStatusMap(ctx('OWNER'), filter), listUnits(ctx('OWNER'), filter), getFloor(ctx('OWNER'), floorId, filter)]);
    const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
    expect(ids(list)).toEqual([unitId]);
    expect(ids(map.buildings[0]!.floors[0]!.units)).toEqual(ids(list));
    expect(ids(floor.units)).toEqual(ids(list));
    expect(map.matched).toBe(1);
    expect(map.kpi.str).toBe(1);
    // поиск по арендатору/собственнику/номеру
    expect((await listUnits(ctx('OWNER'), { q: '1705' })).map((u) => u.unitNo)).toEqual(['1705']);
    expect((await listUnits(ctx('BROKER'), { q: 'каримов' })).map((u) => u.unitNo)).toEqual(['1704']);
  });

  it('BR-P13: без unit.owner.view имя собственника маскируется, контакты не отдаются; финансы — только c unit.finance.view', async () => {
    expect(maskOwnerName('Рустам Каримов')).toBe('Рустам К.');
    const broker = await getUnitCard(ctx('BROKER'), unitId);
    expect(broker.owner?.displayName).toBe('Рустам К.');
    expect(broker.owner?.contactPhone).toBeNull();
    expect(broker.unit.monthlyRentMinor).toBeNull();
    expect(broker.audit).toEqual([]);
    const cm = await getUnitCard(ctx('COMMERCIAL_MANAGER'), unitId);
    expect(cm.owner?.displayName).toBe('Рустам Каримов');
    expect(cm.owner?.contactPhone).toBe('+998901112233');
    expect(cm.audit.length).toBeGreaterThan(3);
    // контакты собственника не попадают в audit (docs/11)
    const created = await prisma.auditLog.findFirst({ where: { tenantId, objectType: 'property_owner', objectId: ownerId } });
    expect(JSON.stringify(created!.after)).not.toContain('998901112233');
  });

  it('активности и цены: права, audit, отрицательные суммы', async () => {
    await expect(addUnitActivity(ctx('MARKETING'), unitId, { kind: 'VIEWING', note: 'x' })).rejects.toThrow(PermissionDeniedError);
    await addUnitActivity(ctx('BROKER'), unitId, { kind: 'VIEWING', note: 'Показали X Company, хотят 35$/м²', expectedRateMinor: 3_500n, followUpAt: new Date('2026-09-25') });
    await expect(updateUnitPricing(ctx('BROKER'), unitId, { askingRateMinor: 1n })).rejects.toThrow(PermissionDeniedError);
    await expect(updateUnitPricing(ctx('OWNER'), unitId, { askingRateMinor: -1n })).rejects.toThrow(ValidationError);
    await updateUnitPricing(ctx('OWNER'), unitId, { askingRateMinor: 130_000n, minApprovedRateMinor: 115_000n });
    const card = await getUnitCard(ctx('OWNER'), unitId);
    expect(card.activities[0]!.kind).toBe('VIEWING');
    expect(card.unit.minApprovedRateMinor).toBe(115_000n);
    expect((await getUnitCard(ctx('BROKER'), unitId)).unit.minApprovedRateMinor).toBeNull();
    const actions = (await prisma.auditLog.findMany({ where: { tenantId, objectId: unitId }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['unit.create', 'unit.status.change', 'unit.publish', 'unit.activity.create', 'unit.pricing.update']));
  });
});
