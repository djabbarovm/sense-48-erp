import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createCatalogItem, createServiceOrder, listServiceOrders, recordHandling, transitionServiceOrder } from '../src/services/serviceOrders.js';
import { cancelServicePackage, createServicePackage, getServicesAnalytics, importPartnerStatement, listPartnerStatements, listServicePackages, runServicePackages } from '../src/services/servicesModel.js';
import { createBuilding, createFloor, createUnit } from '../src/services/property.js';

let tenantId: string;
let opsId: string;
let unitId: string;
let mallUnit: string;
let laundry: string;
let cleaning: string;
let internet: string;
const ctx = (roles: RoleCode[], userId?: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'sv', userId: userId ?? crypto.randomUUID(), roles });
const d = (s: string) => new Date(`${s}T00:00:00Z`);

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-sv-${ts}`, legalName: 'SV', taxId: '300000131', settings: { services_hour_cost_minor: '6000000' } } })).id;
  opsId = (await prisma.user.create({ data: { email: `sv-ops-${ts}@t.test`, fullName: 'Шерзод' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: opsId, role: 'OPERATIONS_MANAGER' } });
  const b = await createBuilding(ctx(['ADMIN']), { code: 'TOWER', name: 'Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 3 });
  unitId = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '301', type: 'APARTMENT', areaM2: 60 })).id;
  const mall = await createBuilding(ctx(['ADMIN']), { code: 'MALL', name: 'Mall', kind: 'MALL' });
  const mf = await createFloor(ctx(['ADMIN']), { buildingId: mall.id, floorNo: 1 });
  mallUnit = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: mf.id, unitNo: 'M1-01', type: 'RETAIL', areaM2: 100 })).id;
  laundry = (await createCatalogItem(ctx(['OPERATIONS_MANAGER'], opsId), { code: 'LAUNDRY', name: 'Химчистка', category: 'LAUNDRY', providerKind: 'PARTNER', partnerName: 'CleanPro', priceMinor: 100_000_00n, commissionBp: 1500, clientDiscountBp: 500, involvement: 'MANAGED' })).id;
  cleaning = (await createCatalogItem(ctx(['OPERATIONS_MANAGER'], opsId), { code: 'CLEAN', name: 'Уборка', category: 'CLEANING', providerKind: 'OWN_OPS', priceMinor: 250_000_00n, terms: 'PACKAGE', slaHours: 24 })).id;
  internet = (await createCatalogItem(ctx(['OPERATIONS_MANAGER'], opsId), { code: 'NET', name: 'Интернет CityNet', category: 'IT', providerKind: 'PARTNER', partnerName: 'CityNet', priceMinor: 0n, commissionBp: 1500, terms: 'REFERRAL_RECURRING', involvement: 'REFERRAL' })).id;
});
afterAll(async () => prisma.$disconnect());

describe('Services v1.0 (BR-P47…P50)', () => {
  it('BR-P47/P48: скидка клиенту не выручка; трёхуровневый снимок; арендаторы Mall — не клиенты Services; канал и профиль клиента', async () => {
    const o = await createServiceOrder(ctx(['BROKER']), { catalogItemId: laundry, unitId, channel: 'TELEGRAM', customerKind: 'RESIDENT' });
    expect(o).toMatchObject({ listPriceMinor: 100_000_00n, priceMinor: 95_000_00n, servicesRevenueMinor: 14_250_00n, executorRevenueMinor: 80_750_00n, channel: 'TELEGRAM', customerKind: 'RESIDENT' });
    const own = await createServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), { catalogItemId: cleaning, unitId, assigneeId: opsId });
    expect(own).toMatchObject({ servicesRevenueMinor: 0n, executorRevenueMinor: 250_000_00n, channel: 'STAFF' }); // внутренняя ставка OPEN → Services 0
    await expect(createServiceOrder(ctx(['BROKER']), { catalogItemId: laundry, unitId: mallUnit })).rejects.toThrow(/SERVICE_NOT_FOR_MALL/);
    await expect(recordHandling(ctx(['BROKER']), o.id, { addMinutes: 10 })).rejects.toThrow(NotFoundError); // не участник
    await recordHandling(ctx(['OPERATIONS_MANAGER'], opsId), o.id, { addMinutes: 20 });
    const after = await recordHandling(ctx(['OPERATIONS_MANAGER'], opsId), o.id, { addMinutes: 10, complaint: true, complaintNote: 'пятно осталось' });
    expect(after.handlingMinutes).toBe(30);
    expect(after.complaint).toBe(true);
    await expect(recordHandling(ctx(['OPERATIONS_MANAGER'], opsId), o.id, { addMinutes: -1 })).rejects.toThrow(/MINUTES_INVALID/);
  });

  it('BR-P50: пакет генерирует заказы по частоте c пакетной ценой; отмена останавливает; собственник — только по своему юниту', async () => {
    await expect(createServicePackage(ctx(['PROPERTY_OWNER']), { catalogItemId: cleaning, unitId, runsPerMonth: 8, monthlyPriceMinor: 1_200_000_00n })).rejects.toThrow(NotFoundError);
    const p = await createServicePackage(ctx(['OPERATIONS_MANAGER'], opsId), { catalogItemId: cleaning, unitId, customerName: 'Жилец 301', runsPerMonth: 8, monthlyPriceMinor: 1_200_000_00n, startAt: d('2026-09-01') }, d('2026-09-01'));
    expect(p.nextRunAt.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(await runServicePackages(tenantId, new Date('2026-09-01T09:00:00Z'))).toBe(1);
    expect(await runServicePackages(tenantId, new Date('2026-09-02T09:00:00Z'))).toBe(0); // следующий через ~4 дня
    expect(await runServicePackages(tenantId, new Date('2026-09-05T09:00:00Z'))).toBe(1);
    const orders = (await listServiceOrders(ctx(['OWNER']), {})).filter((o) => o.packageId === p.id);
    expect(orders).toHaveLength(2);
    expect(orders[0]!.priceMinor).toBe(150_000_00n); // 1 200 000 / 8
    const list = await listServicePackages(ctx(['OWNER']));
    expect(list.find((x) => x.id === p.id)).toMatchObject({ ordersCount: 2, unitNo: '301', status: 'ACTIVE' });
    await expect(cancelServicePackage(ctx(['OPERATIONS_MANAGER'], opsId), p.id, '')).rejects.toThrow(/REASON_REQUIRED/);
    await cancelServicePackage(ctx(['OPERATIONS_MANAGER'], opsId), p.id, 'жилец съехал');
    expect(await runServicePackages(tenantId, new Date('2026-10-01T09:00:00Z'))).toBe(0);
  });

  it('referral-отчёт партнёра: идемпотентный импорт, ставка направления по умолчанию; аналитика — GMV ≠ выручка, contribution, penetration', async () => {
    await expect(importPartnerStatement(ctx(['BROKER']), { partnerName: 'CityNet', period: '2026-08', csv: '301;120000' })).rejects.toThrow(PermissionDeniedError);
    await expect(importPartnerStatement(ctx(['OPERATIONS_MANAGER'], opsId), { partnerName: 'CityNet', period: '08/2026', csv: '301;120000' })).rejects.toThrow(/PERIOD_INVALID/);
    const rep = await importPartnerStatement(ctx(['OPERATIONS_MANAGER'], opsId), { partnerName: 'CityNet', period: '2026-08', csv: 'customer;base;fee\n301;120000\n302;80000;10\n' });
    expect(rep).toMatchObject({ imported: 2, skipped: 0, feeMinor: 18_000_00n + 8_000_00n, baseMinor: 200_000_00n });
    const again = await importPartnerStatement(ctx(['OPERATIONS_MANAGER'], opsId), { partnerName: 'CityNet', period: '2026-08', csv: '301;120000\n303;50000' });
    expect(again).toMatchObject({ imported: 1, skipped: 1 });
    await expect(importPartnerStatement(ctx(['OPERATIONS_MANAGER'], opsId), { partnerName: 'Unknown', period: '2026-08', csv: '301;120000' })).rejects.toThrow(/FEE_REQUIRED/);
    expect((await listPartnerStatements(ctx(['OWNER']), { period: '2026-08' })).length).toBe(3);
    // закрыть заказ химчистки, чтобы попал в GMV
    const laundryOrder = (await listServiceOrders(ctx(['OWNER']), {})).find((o) => o.catalogItemId === laundry)!;
    await transitionServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), laundryOrder.id, 'start');
    await transitionServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), laundryOrder.id, 'done');
    const a = await getServicesAnalytics(ctx(['OWNER']), 365, new Date());
    const dir = a.directions.find((l) => l.category === 'LAUNDRY')!;
    expect(dir).toMatchObject({ orders: 1, gmvMinor: 95_000_00n, servicesRevenueMinor: 14_250_00n, executorRevenueMinor: 80_750_00n, costToServeMinor: 3_000_000n, complaints: 1, avgHandlingMinutes: 30 }); // 30 мин × 60 000 сум/ч
    expect(dir.contributionMinor).toBe(14_250_00n - 3_000_000n);
    expect(a.totals.referralMinor).toBe(33_500_00n); // 18 000 + 8 000 + 7 500 (ставка направления 15% для 303)
    expect(a.totals.servicesRevenueMinor).toBe(14_250_00n + 33_500_00n);
    expect(a.byChannel.find((c) => c.channel === 'TELEGRAM')?.orders).toBe(1);
    expect(a.demand.buyers).toBeGreaterThanOrEqual(1);
    expect(a.packages.active).toBe(0);
    expect(internet).toBeTruthy();
  });
});
