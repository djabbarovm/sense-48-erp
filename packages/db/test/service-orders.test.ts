import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { LocalFsStorage } from '@finance-os/adapters';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '../src/client.js';
import { createCatalogItem, createServiceOrder, escalateOverdueServiceOrders, getServiceOrder, getServicesSummary, listCatalog, listServiceOrders, rateServiceOrder, transitionServiceOrder, updateCatalogItem } from '../src/services/serviceOrders.js';
import { createBuilding, createFloor, createUnit } from '../src/services/property.js';
import { uploadDocument } from '../src/services/documents.js';
import { getControlRoom } from '../src/services/controlRoom.js';

let tenantId: string;
let opsId: string;
let ops2Id: string;
let brokerId: string;
let unitId: string;
let partnerItem: string;
let ownItem: string;
const ctx = (roles: RoleCode[], userId?: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'so', userId: userId ?? crypto.randomUUID(), roles });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-so-${ts}`, legalName: 'SO', taxId: '300000081' } })).id;
  opsId = (await prisma.user.create({ data: { email: `so-ops1-${ts}@t.test`, fullName: 'Шерзод' } })).id;
  ops2Id = (await prisma.user.create({ data: { email: `so-ops2-${ts}@t.test`, fullName: 'Рустам' } })).id;
  brokerId = (await prisma.user.create({ data: { email: `so-broker-${ts}@t.test`, fullName: 'Бекзод' } })).id;
  await prisma.userTenantRole.createMany({ data: [{ tenantId, userId: opsId, role: 'OPERATIONS_MANAGER' }, { tenantId, userId: ops2Id, role: 'OPERATIONS_MANAGER' }, { tenantId, userId: brokerId, role: 'BROKER' }] });
  const b = await createBuilding(ctx(['ADMIN']), { code: 'TOWER', name: 'Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 30 });
  unitId = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '3004', type: 'APARTMENT', areaM2: 70 })).id;
});
afterAll(async () => prisma.$disconnect());

describe('Wave 5 — services marketplace (BR-P35/P36, BR-P32)', () => {
  let orderId: string;
  it('каталог: партнёрская услуга требует партнёра, код уникален, только service.catalog; список без неактивных', async () => {
    await expect(createCatalogItem(ctx(['BROKER']), { code: 'CLEAN-STD', name: 'Уборка', category: 'CLEANING', providerKind: 'OWN_OPS', priceMinor: 300_000_00n })).rejects.toThrow(PermissionDeniedError);
    await expect(createCatalogItem(ctx(['OPERATIONS_MANAGER'], opsId), { code: 'LAUNDRY', name: 'Стирка', category: 'LAUNDRY', providerKind: 'PARTNER', priceMinor: 100_000_00n, commissionBp: 1500 })).rejects.toThrow(/PARTNER_REQUIRED/);
    ownItem = (await createCatalogItem(ctx(['OPERATIONS_MANAGER'], opsId), { code: 'CLEAN-STD', name: 'Уборка стандарт', category: 'CLEANING', providerKind: 'OWN_OPS', priceMinor: 300_000_00n, slaHours: 24 })).id;
    partnerItem = (await createCatalogItem(ctx(['OPERATIONS_MANAGER'], opsId), { code: 'LAUNDRY', name: 'Стирка и глажка', category: 'LAUNDRY', providerKind: 'PARTNER', partnerName: 'CleanPro', priceMinor: 100_000_00n, commissionBp: 1500, slaHours: 48 })).id;
    await expect(createCatalogItem(ctx(['OPERATIONS_MANAGER'], opsId), { code: 'CLEAN-STD', name: 'Дубль', category: 'CLEANING', providerKind: 'OWN_OPS', priceMinor: 1n })).rejects.toThrow(/CODE_TAKEN/);
    const inactive = await createCatalogItem(ctx(['ADMIN']), { code: 'OLD', name: 'Старая', category: 'OTHER', providerKind: 'OWN_OPS', priceMinor: 1n, active: false });
    expect((await listCatalog(ctx(['BROKER']))).map((c) => c.code)).toEqual(['CLEAN-STD', 'LAUNDRY']);
    expect((await listCatalog(ctx(['ADMIN']), { includeInactive: true })).map((c) => c.code)).toContain('OLD');
    await expect(createServiceOrder(ctx(['BROKER'], brokerId), { catalogItemId: inactive.id, unitId })).rejects.toThrow(/SERVICE_INACTIVE/);
    await expect(listCatalog(ctx(['ACCOUNTANT']))).resolves.toBeDefined();
  });

  it('BR-P35: заказ фиксирует цену и комиссию каталога; смена цены не меняет заказ; брокер без назначения; SLA = scheduledAt + slaHours', async () => {
    const now = new Date('2026-09-19T10:00:00Z');
    const o = await createServiceOrder(ctx(['BROKER'], brokerId), { catalogItemId: partnerItem, unitId, quantity: 2, customerName: 'CityNet', assigneeId: opsId, scheduledAt: new Date('2026-09-20T09:00:00Z') }, now);
    orderId = o.id;
    expect(o.number).toMatch(/^SO-\d{4}-\d{6}$/);
    expect(o.status).toBe('NEW');
    expect(o.assigneeId).toBeNull();
    expect(o.priceMinor).toBe(200_000_00n);
    expect(o.commissionBp).toBe(1500);
    expect(o.partnerName).toBe('CleanPro');
    expect(o.dueAt.toISOString()).toBe('2026-09-22T09:00:00.000Z');
    await updateCatalogItem(ctx(['OPERATIONS_MANAGER'], opsId), partnerItem, { priceMinor: 999_999_00n, commissionBp: 5000 });
    const row = (await listServiceOrders(ctx(['OWNER']), {}, now)).find((r) => r.id === orderId)!;
    expect(row.priceMinor).toBe(200_000_00n);
    expect(row.platformRevenueMinor).toBe(30_000_00n);
    expect(row.partnerPayoutMinor).toBe(170_000_00n);
    await expect(createServiceOrder(ctx(['ACCOUNTANT']), { catalogItemId: partnerItem, unitId })).rejects.toThrow(PermissionDeniedError);
    await expect(createServiceOrder(ctx(['BROKER'], brokerId), { catalogItemId: partnerItem })).rejects.toThrow(/LOCATION_REQUIRED/);
    await expect(createServiceOrder(ctx(['BROKER'], brokerId), { catalogItemId: partnerItem, unitId, quantity: 0 })).rejects.toThrow(/QUANTITY_INVALID/);
  });

  it('accept → start → done; verify требует подтверждения и другого человека (BR-P32); оценка только выполненного и только заказчиком/ops', async () => {
    await expect(transitionServiceOrder(ctx(['BROKER'], brokerId), orderId, 'accept')).rejects.toThrow(PermissionDeniedError);
    const acc = await transitionServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), orderId, 'accept', { assigneeId: opsId });
    expect(acc.status).toBe('ACCEPTED');
    expect(acc.assigneeId).toBe(opsId);
    await transitionServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), orderId, 'start');
    await expect(rateServiceOrder(ctx(['BROKER'], brokerId), orderId, 5)).rejects.toThrow(/NOT_DONE/);
    const done = await transitionServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), orderId, 'done');
    expect(done.status).toBe('DONE');
    await expect(transitionServiceOrder(ctx(['OPERATIONS_MANAGER'], ops2Id), orderId, 'verify')).rejects.toThrow(/PROOF_REQUIRED/);
    const storage = new LocalFsStorage(mkdtempSync(join(tmpdir(), 'so-')));
    await uploadDocument(ctx(['OPERATIONS_MANAGER'], opsId), storage, { objectType: 'service_order', objectId: orderId, docType: 'ACT', fileName: 'act.pdf', mime: 'application/pdf', body: Buffer.from('pdf') });
    await expect(transitionServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), orderId, 'verify')).rejects.toThrow(/QA_SELF_VERIFY/);
    const verified = await transitionServiceOrder(ctx(['COMMERCIAL_MANAGER']), orderId, 'verify');
    expect(verified.status).toBe('VERIFIED');
    await expect(rateServiceOrder(ctx(['MARKETING']), orderId, 5)).rejects.toThrow(NotFoundError); // не заказчик
    await expect(rateServiceOrder(ctx(['BROKER'], brokerId), orderId, 7)).rejects.toThrow(/RATING_INVALID/);
    const rated = await rateServiceOrder(ctx(['BROKER'], brokerId), orderId, 4, 'Нормально');
    expect(rated.rating).toBe(4);
    const card = await getServiceOrder(ctx(['OPERATIONS_MANAGER'], ops2Id), orderId);
    expect(card.proofs).toHaveLength(1);
    expect(card.triggers).toEqual(['reopen']);
    const actions = (await prisma.auditLog.findMany({ where: { tenantId, objectType: 'service_order', objectId: orderId }, orderBy: { seq: 'asc' }, select: { action: true, after: true } }));
    expect(actions.map((a) => a.action)).toEqual(['service_order.create', 'service_order.accept', 'service_order.start', 'service_order.done', 'service_order.verify', 'service_order.rate']);
    expect(JSON.stringify(actions)).not.toContain('Нормально'); // комментарий не в audit
  });

  it('BR-P36: GMV/выручка только по DONE/VERIFIED и по виду исполнителя; просрочка → Task + событие; пульт; 404 чужой tenant', async () => {
    const now = new Date('2026-09-19T10:00:00Z');
    const own = await createServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), { catalogItemId: ownItem, unitId, assigneeId: ops2Id }, now);
    expect(own.status).toBe('ACCEPTED');
    const cancelled = await createServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), { catalogItemId: ownItem, unitId }, now);
    await expect(transitionServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), cancelled.id, 'cancel')).rejects.toThrow(/REASON_REQUIRED/);
    await transitionServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), cancelled.id, 'cancel', { reason: 'клиент передумал' });
    let s = await getServicesSummary(ctx(['OWNER']), { days: 30 }, now);
    expect(s.gmvMinor).toBe(200_000_00n); // только VERIFIED партнёрский заказ
    expect(s.platformRevenueMinor).toBe(30_000_00n);
    expect(s.partnerPayoutMinor).toBe(170_000_00n);
    expect(s.open).toBe(1);
    await transitionServiceOrder(ctx(['OPERATIONS_MANAGER'], ops2Id), own.id, 'done', {}, new Date('2026-09-19T12:00:00Z'));
    s = await getServicesSummary(ctx(['OWNER']), { days: 30 }, now);
    expect(s.gmvMinor).toBe(500_000_00n);
    expect(s.platformRevenueMinor).toBe(330_000_00n); // OWN_OPS — вся сумма
    expect(s.byProvider.map((p) => [p.providerKind, p.partnerName, p.orders])).toEqual(expect.arrayContaining([['PARTNER', 'CleanPro', 1], ['OWN_OPS', null, 2]]));
    expect(s.avgRating).toBe(4);
    // просрочка
    const late = await createServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), { catalogItemId: ownItem, unitId, assigneeId: ops2Id, scheduledAt: now }, now);
    expect(await escalateOverdueServiceOrders(tenantId, new Date('2026-09-21T10:00:00Z'))).toBe(1);
    expect(await escalateOverdueServiceOrders(tenantId, new Date('2026-09-21T11:00:00Z'))).toBe(0);
    expect((await prisma.task.findFirst({ where: { tenantId, type: 'SERVICE_ORDER_OVERDUE', objectId: late.id } }))?.ownerId).toBe(ops2Id);
    expect((await listServiceOrders(ctx(['OWNER']), { overdueOnly: true }, new Date('2026-09-21T10:00:00Z'))).map((o) => o.id)).toEqual([late.id]);
    const cr = await getControlRoom(ctx(['OWNER']), new Date('2026-09-21T10:00:00Z'));
    expect(cr.services?.overdue).toBe(1);
    expect((await getControlRoom(ctx(['REQUESTER']))).services).toBeNull();
    const other = (await prisma.tenant.create({ data: { slug: `t-soo-${Date.now()}`, legalName: 'O', taxId: '300000082' } })).id;
    await expect(getServiceOrder(unsafeCreateTenantContext({ tenantId: other, tenantSlug: 'o', userId: 'u', roles: ['OWNER'] }), orderId)).rejects.toThrow(NotFoundError);
    expect((await prisma.domainEvent.findMany({ where: { tenantId, type: { startsWith: 'service_order.' } } })).length).toBeGreaterThanOrEqual(8);
  });
});
