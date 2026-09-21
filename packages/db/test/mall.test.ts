import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createAsset, createAssetContract, createMandate, endAssetContract, getMallDashboard, listAssets, listMandates, ownerMallReport, setLeaseTenantCategory, transitionMandate, updateMandate } from '../src/services/mall.js';
import { createBuilding, createFloor, createPropertyOwner, createUnit, getUnitCard } from '../src/services/property.js';
import { activateLease, createLease } from '../src/services/leases.js';
import { generateRentCharges } from '../src/services/rent.js';
import { getOwnerPortal } from '../src/services/ownerPortal.js';

let tenantId: string;
let mallId: string;
let towerUnit: string;
let m1: string;
let m2: string;
let m3: string;
let ownerId: string;
let ownerUserId: string;
const ctx = (roles: RoleCode[], userId?: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'mall', userId: userId ?? crypto.randomUUID(), roles });
const d = (s: string) => new Date(`${s}T00:00:00Z`);

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-mall-${ts}`, legalName: 'MALL', taxId: '300000121', settings: { mall_rate_scenarios: { '1': { conservative: 3000, base: 4000, optimistic: 5000 } } } } })).id;
  ownerUserId = (await prisma.user.create({ data: { email: `mall-owner-${ts}@t.test`, fullName: 'Собственник ТРЦ' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: ownerUserId, role: 'PROPERTY_OWNER' } });
  const mall = await createBuilding(ctx(['ADMIN']), { code: 'MALL', name: 'Piramit Mall', kind: 'MALL' });
  mallId = mall.id;
  const f1 = await createFloor(ctx(['ADMIN']), { buildingId: mall.id, floorNo: 1 });
  const tower = await createBuilding(ctx(['ADMIN']), { code: 'TOWER', name: 'Tower', kind: 'TOWER' });
  const tf = await createFloor(ctx(['ADMIN']), { buildingId: tower.id, floorNo: 5 });
  ownerId = (await createPropertyOwner(ctx(['COMMERCIAL_MANAGER']), { kind: 'COMPANY', displayName: 'Silk Road Retail' })).id;
  await prisma.propertyOwner.update({ where: { id: ownerId }, data: { userId: ownerUserId } });
  const other = (await createPropertyOwner(ctx(['COMMERCIAL_MANAGER']), { kind: 'PERSON', displayName: 'Другой' })).id;
  m1 = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f1.id, unitNo: 'M1-01', type: 'RETAIL', areaM2: 100, ownerId })).id;
  m2 = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f1.id, unitNo: 'M1-02', type: 'RETAIL', areaM2: 50, ownerId: other })).id;
  m3 = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f1.id, unitNo: 'M1-03', type: 'RETAIL', areaM2: 150 })).id; // без собственника
  towerUnit = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: tf.id, unitNo: '501', type: 'APARTMENT', areaM2: 70, ownerId })).id;
  const l1 = await createLease(ctx(['COMMERCIAL_MANAGER']), { unitId: m1, type: 'LTR', occupantName: 'Zara', startAt: d('2026-01-01'), endAt: d('2028-12-31'), rentMinor: 400_000n, tenantCategory: 'FASHION' });
  await activateLease(ctx(['COMMERCIAL_MANAGER']), l1.id, d('2026-01-01'));
  const l2 = await createLease(ctx(['COMMERCIAL_MANAGER']), { unitId: m2, type: 'LTR', occupantName: 'Coffee', startAt: d('2026-01-01'), endAt: d('2026-10-15'), rentMinor: 250_000n });
  await activateLease(ctx(['COMMERCIAL_MANAGER']), l2.id, d('2026-01-01'));
});
afterAll(async () => prisma.$disconnect());

describe('ORDO Mall — мандаты, tenant mix, линии актива (BR-P45/P46)', () => {
  let mandateId: string;
  it('BR-P45: мандат только для помещений ТРЦ и c собственником; один незакрытый; активация делает помещение управляемым → аренда начисляется', async () => {
    await expect(createMandate(ctx(['BROKER']), { unitId: m1 })).rejects.toThrow(PermissionDeniedError);
    await expect(createMandate(ctx(['COMMERCIAL_MANAGER']), { unitId: towerUnit })).rejects.toThrow(/NOT_MALL_UNIT/);
    await expect(createMandate(ctx(['COMMERCIAL_MANAGER']), { unitId: m3 })).rejects.toThrow(/MANDATE_OWNER_REQUIRED/);
    await expect(createMandate(ctx(['COMMERCIAL_MANAGER']), { unitId: m1, feeBp: 12_000 })).rejects.toThrow(/FEE_INVALID/);
    const m = await createMandate(ctx(['COMMERCIAL_MANAGER']), { unitId: m1, successFeeMonths: 0.5 });
    mandateId = m.id;
    expect(m.status).toBe('DRAFT');
    expect(m.feeBp).toBeNull(); // OPEN
    await expect(createMandate(ctx(['COMMERCIAL_MANAGER']), { unitId: m1 })).rejects.toThrow(/MANDATE_EXISTS/);
    await expect(transitionMandate(ctx(['COMMERCIAL_MANAGER']), mandateId, 'activate')).rejects.toThrow(/Illegal transition/);
    await transitionMandate(ctx(['COMMERCIAL_MANAGER']), mandateId, 'sign', { signedAt: d('2026-09-05') });
    expect((await getUnitCard(ctx(['OWNER']), m1)).unit.managedByPlatform).toBe(false);
    const active = await transitionMandate(ctx(['COMMERCIAL_MANAGER']), mandateId, 'activate', {}, d('2026-09-10'));
    expect(active.status).toBe('ACTIVE');
    expect((await getUnitCard(ctx(['OWNER']), m1)).unit.managedByPlatform).toBe(true);
    expect(await generateRentCharges(tenantId, d('2026-09-15'), { fromMonth: d('2026-09-01') })).toBe(1); // только M1-01 (под управлением)
    const rows = await listMandates(ctx(['COMMERCIAL_MANAGER']), { buildingId: mallId });
    expect(rows.map((r) => [r.unitNo, r.status, r.ownerName, r.successFee])).toEqual([['M1-01', 'ACTIVE', 'Silk Road Retail', 0.5]]);
    const actions = (await prisma.auditLog.findMany({ where: { tenantId, objectType: 'mall_mandate', objectId: mandateId }, orderBy: { seq: 'asc' }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(['mall_mandate.create', 'mall_mandate.sign', 'mall_mandate.activate']);
  });

  it('BR-P46: проценты собственнику только после утверждения и публикации; fee в дашборде не считается при OPEN', async () => {
    await expect(updateMandate(ctx(['COMMERCIAL_MANAGER']), mandateId, { feePublished: true })).rejects.toThrow(/FEE_NOT_APPROVED/);
    let report = await ownerMallReport(ctx(['PROPERTY_OWNER'], ownerUserId), ownerId, d('2026-09-15'));
    expect(report?.[0]).toMatchObject({ unitNo: 'M1-01', tenantCategory: 'FASHION', rentMinor: 400_000n, ratePerM2Minor: 4_000n });
    expect(report?.[0]?.mandate?.feeBp).toBeNull();
    let dash = await getMallDashboard(ctx(['OWNER']), mallId, d('2026-09-15'));
    expect(dash.controlled?.feeOpenUnits).toBe(1);
    await updateMandate(ctx(['COMMERCIAL_MANAGER']), mandateId, { feeBp: 600 });
    await updateMandate(ctx(['COMMERCIAL_MANAGER']), mandateId, { feePublished: true });
    report = await ownerMallReport(ctx(['PROPERTY_OWNER'], ownerUserId), ownerId, d('2026-09-15'));
    expect(report?.[0]?.mandate).toMatchObject({ status: 'ACTIVE', feeBp: 600, successFee: 0.5, feePublished: true });
    dash = await getMallDashboard(ctx(['OWNER']), mallId, d('2026-09-15'));
    expect(dash.controlled?.feeOpenUnits).toBe(0);
    expect(dash.controlled?.chargedMinor).toBe(400_000n);
    expect((await getMallDashboard(ctx(['BROKER']), mallId)).controlled).toBeNull(); // нет mall.fee.view
    const portal = await getOwnerPortal(ctx(['PROPERTY_OWNER'], ownerUserId), d('2026-09-15'));
    expect(portal.mall?.map((u) => u.unitNo)).toEqual(['M1-01']); // квартира 501 — не в отчёте ТРЦ
  });

  it('дашборд: KPI по GLA, tenant mix, сценарии ставок по этажам, линии актива; категория арендатора; изоляция тенанта', async () => {
    const dash = await getMallDashboard(ctx(['COMMERCIAL_MANAGER']), mallId, d('2026-09-15'));
    expect(dash.kpi).toMatchObject({ glaM2: 300, leasedGlaM2: 150, occupancyByGlaPct: 50, units: 3, leasedUnits: 2, mandateActive: 1, mandateCoverageGlaPct: 33.3, expiring90: 1 });
    expect(dash.tenantMix.map((l) => [l.category, l.sharePct])).toEqual([['FASHION', 66.7], ['OTHER', 33.3]]);
    const lease2 = await prisma.leaseContract.findFirstOrThrow({ where: { tenantId, unitId: m2 } });
    await expect(setLeaseTenantCategory(ctx(['BROKER']), lease2.id, 'FOOD_BEVERAGE')).rejects.toThrow(PermissionDeniedError);
    await setLeaseTenantCategory(ctx(['COMMERCIAL_MANAGER']), lease2.id, 'FOOD_BEVERAGE');
    expect((await getMallDashboard(ctx(['COMMERCIAL_MANAGER']), mallId, d('2026-09-15'))).tenantMix.map((l) => l.category)).toEqual(['FASHION', 'FOOD_BEVERAGE']);
    expect(dash.scenarios).toEqual({ conservative: 900_000n, base: 1_200_000n, optimistic: 1_500_000n }); // 300 м² × $30/$40/$50
    // линии актива
    await expect(createAsset(ctx(['BROKER']), { buildingId: mallId, kind: 'MEDIA', code: 'LED-01', name: 'LED-экран атриум' })).rejects.toThrow(PermissionDeniedError);
    const led = await createAsset(ctx(['COMMERCIAL_MANAGER']), { buildingId: mallId, kind: 'MEDIA', code: 'LED-01', name: 'LED-экран атриум', tariffMinor: 150_000n });
    await expect(createAsset(ctx(['COMMERCIAL_MANAGER']), { buildingId: mallId, kind: 'MEDIA', code: 'LED-01', name: 'дубль' })).rejects.toThrow(/CODE_TAKEN/);
    const c = await createAssetContract(ctx(['COMMERCIAL_MANAGER']), { assetId: led.id, counterpartyName: 'Coca-Cola', monthlyMinor: 120_000n, startAt: d('2026-09-01'), endAt: d('2027-08-31') });
    await createAssetContract(ctx(['COMMERCIAL_MANAGER']), { assetId: led.id, counterpartyName: 'Past', monthlyMinor: 50_000n, startAt: d('2025-01-01'), endAt: d('2025-12-31') });
    const assets = await listAssets(ctx(['OWNER']), mallId, d('2026-09-15'));
    expect(assets[0]?.monthlyMinor).toBe(120_000n); // только действующий договор
    expect((await getMallDashboard(ctx(['OWNER']), mallId, d('2026-09-15'))).assets.byKind.find((k) => k.kind === 'MEDIA')?.monthlyMinor).toBe(120_000n);
    await endAssetContract(ctx(['COMMERCIAL_MANAGER']), c.id, d('2026-09-14'));
    expect((await listAssets(ctx(['OWNER']), mallId, d('2026-09-15')))[0]?.monthlyMinor).toBe(0n);
    const other = (await prisma.tenant.create({ data: { slug: `t-mallo-${Date.now()}`, legalName: 'O', taxId: '300000122' } })).id;
    await expect(transitionMandate(unsafeCreateTenantContext({ tenantId: other, tenantSlug: 'o', userId: 'u', roles: ['OWNER'] }), mandateId, 'terminate', { reason: 'x' })).rejects.toThrow(NotFoundError);
    await transitionMandate(ctx(['COMMERCIAL_MANAGER']), mandateId, 'terminate', { reason: 'собственник отозвал' });
    expect((await getUnitCard(ctx(['OWNER']), m1)).unit.managedByPlatform).toBe(false);
  });
});
