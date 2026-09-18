import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { parseFloorPlanSvg } from '@finance-os/adapters';
import { prisma } from '../src/client.js';
import { importFloorPlan, importInventoryXlsx } from '../src/services/propertyImport.js';
import { getFloor, getStatusMap } from '../src/services/property.js';

let tenantId: string;
const ctx = (...roles: RoleCode[]) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'pi', userId: crypto.randomUUID(), roles });

const row = (o: Record<string, string>) => ({
  building_code: 'TOWER', building_name: 'Tower', building_kind: 'TOWER', floor_no: '12', unit_no: '1201', unit_type: 'APARTMENT', area_m2: '126,6',
  owner_name: 'Рустам Каримов', owner_kind: 'PERSON', owner_phone: '+998901234567', owner_email: 'o@example.test', management_consent: 'Y', managed_by_platform: 'Y',
  readiness: 'READY', occupancy: 'OCCUPIED', rental_mode: 'LTR', lease_status: 'ACTIVE', commercial_status: 'CONTRACTED', occupant_name: 'CityNet LLC',
  lease_ends_at: '2027-03-01', asking_rate: '1350', currency: 'USD', monthly_rent: '1200,50', ...o,
});

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { slug: `t-pi-${Date.now()}`, legalName: 'PI', taxId: '300000023' } })).id;
});
afterAll(async () => prisma.$disconnect());

describe('P-07 импорт инвентаря', () => {
  it('403 без property.manage', async () => {
    await expect(importInventoryXlsx(ctx('BROKER'), [row({})])).rejects.toThrow(PermissionDeniedError);
  });

  it('all-or-nothing: ошибки строк (enum, BR-P04, BR-P10, дубликат, здание без name) — ничего не записано', async () => {
    const report = await importInventoryXlsx(ctx('COMMERCIAL_MANAGER'), [
      row({}),
      row({ unit_no: '1201' }), // дубликат в файле
      row({ unit_no: '1202', readiness: 'FITOUT', commercial_status: 'AVAILABLE' }), // BR-P04
      row({ unit_no: '1203', occupancy: 'OWNER_USE', rental_mode: 'STR' }), // BR-P10
      row({ unit_no: '1204', unit_type: 'VILLA' }),
      row({ building_code: 'MALL', building_name: '', building_kind: '', unit_no: 'M1-01' }),
    ]);
    expect(report.imported).toBe(0);
    const fields = report.errors.map((e) => `${e.row}:${e.field}`);
    expect(fields).toContain('3:unit_no');
    expect(fields).toContain('4:commercial_status');
    expect(fields).toContain('5:commercial_status');
    expect(fields).toContain('6:unit_type');
    expect(fields).toContain('7:building_name');
    expect(await prisma.unit.count({ where: { tenantId } })).toBe(0);
    expect(await prisma.building.count({ where: { tenantId } })).toBe(0);
  });

  it('чистый файл: здание/этаж/собственник создаются, статусы и суммы разобраны, audit; повтор → skipped (BR-P15)', async () => {
    const rows = [
      row({}),
      row({ unit_no: '1202', building_name: '', building_kind: '', owner_name: '', occupancy: 'VACANT', rental_mode: 'NONE', lease_status: 'NONE', commercial_status: 'AVAILABLE', occupant_name: '', lease_ends_at: '', monthly_rent: '' }),
      row({ unit_no: 'T12-CORE', unit_type: 'TECHNICAL', owner_name: '', occupancy: 'UNAVAILABLE', rental_mode: 'NONE', lease_status: 'NONE', commercial_status: 'OFF_MARKET', occupant_name: '', lease_ends_at: '', asking_rate: '', monthly_rent: '' }),
      row({ building_code: 'mall', building_name: 'Mall', building_kind: 'MALL', floor_no: '1', unit_no: 'M1-01', unit_type: 'RETAIL', owner_name: 'рустам каримов', occupancy: 'VACANT', rental_mode: 'NONE', lease_status: 'NONE', commercial_status: 'NEGOTIATION', occupant_name: '', lease_ends_at: '', monthly_rent: '' }),
    ];
    const report = await importInventoryXlsx(ctx('COMMERCIAL_MANAGER'), rows);
    expect(report.errors).toEqual([]);
    expect(report.imported).toBe(4);
    expect(await prisma.building.count({ where: { tenantId } })).toBe(2);
    expect(await prisma.propertyOwner.count({ where: { tenantId } })).toBe(1); // регистронезависимое сопоставление
    const u = await prisma.unit.findFirstOrThrow({ where: { tenantId, unitNo: '1201' }, include: { owner: true } });
    expect(u.monthlyRentMinor).toBe(120_050n);
    expect(u.askingRateMinor).toBe(135_000n);
    expect(Number(u.areaM2)).toBe(126.6);
    expect(u.owner?.managementConsent).toBe(true);
    expect(u.vacantSince).toBeNull();
    const vacant = await prisma.unit.findFirstOrThrow({ where: { tenantId, unitNo: '1202' } });
    expect(vacant.vacantSince).not.toBeNull();
    const map = await getStatusMap(ctx('OWNER'));
    expect(map.kpi.commercial).toBe(3);
    expect(map.kpi.occupied).toBe(1);
    expect(await prisma.auditLog.count({ where: { tenantId, action: 'unit.create' } })).toBe(4);
    expect(await prisma.auditLog.count({ where: { tenantId, action: 'building.create' } })).toBe(2);

    const again = await importInventoryXlsx(ctx('COMMERCIAL_MANAGER'), [...rows, row({ unit_no: '1205', owner_name: '' })]);
    expect(again.skipped).toBe(4);
    expect(again.imported).toBe(1);
  });
});

describe('P-08 импорт плана этажа', () => {
  it('SVG → геометрия юнитов, версия этажа растёт, audit; неизвестный юнит → отказ', async () => {
    const bad = await importFloorPlan(ctx('COMMERCIAL_MANAGER'), { buildingCode: 'TOWER', floorNo: 12, viewBox: '0 0 1000 600', units: { '1201': [[0, 0], [1, 0], [1, 1]], '9999': [[0, 0], [1, 0], [1, 1]] } });
    expect(bad.updated).toBe(0);
    expect(bad.errors[0]?.unitNo).toBe('9999');

    const svg = `<svg viewBox="0 0 1000 600"><rect id="1201" x="0" y="0" width="500" height="230"/><polygon data-unit="1202" points="500,0 1000,0 1000,230 500,230"/><path id="T12-CORE" d="M300 250 h400 v100 h-400 z"/></svg>`;
    const { spec } = parseFloorPlanSvg(svg);
    const ok = await importFloorPlan(ctx('COMMERCIAL_MANAGER'), { buildingCode: 'tower', floorNo: 12, viewBox: spec.viewBox, units: spec.units });
    expect(ok.updated).toBe(3);
    expect(ok.geometryVersion).toBe(2);
    const floor = await getFloor(ctx('BROKER'), ok.floorId);
    expect(floor.units.find((u) => u.unitNo === '1202')?.geometry?.points).toEqual([[500, 0], [1000, 0], [1000, 230], [500, 230]]);
    expect(await prisma.auditLog.count({ where: { tenantId, action: 'floor.geometry.import' } })).toBe(1);
    await expect(importFloorPlan(ctx('COMMERCIAL_MANAGER'), { buildingCode: 'NOPE', floorNo: 1, viewBox: '0 0 1 1', units: {} })).rejects.toThrow(/BUILDING_NOT_FOUND/);
    await expect(importFloorPlan(ctx('BROKER'), { buildingCode: 'TOWER', floorNo: 12, viewBox: '0 0 1 1', units: {} })).rejects.toThrow(PermissionDeniedError);
  });
});
