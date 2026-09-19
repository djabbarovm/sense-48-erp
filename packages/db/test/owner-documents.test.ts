import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { LocalFsStorage } from '@finance-os/adapters';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prisma } from '../src/client.js';
import { createOwnerServiceOrder, getOwnerDocumentUrl, getOwnerPortal, listOwnerDocuments, rateOwnerServiceOrder, uploadOwnerDocument } from '../src/services/ownerPortal.js';
import { createBuilding, createFloor, createPropertyOwner, createUnit } from '../src/services/property.js';
import { activateLease, createLease } from '../src/services/leases.js';
import { listDocumentsFor, uploadDocument } from '../src/services/documents.js';
import { createCatalogItem, transitionServiceOrder, rateServiceOrder } from '../src/services/serviceOrders.js';

let tenantId: string;
let ownerUserId: string;
let myUnit: string;
let otherUnit: string;
let myLease: string;
let otherLease: string;
let opsId: string;
const ctx = (roles: RoleCode[], userId?: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'od', userId: userId ?? crypto.randomUUID(), roles });
const me = () => ctx(['PROPERTY_OWNER'], ownerUserId);
const storage = new LocalFsStorage(mkdtempSync(join(tmpdir(), 'od-')));

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-od-${ts}`, legalName: 'OD', taxId: '300000091' } })).id;
  ownerUserId = (await prisma.user.create({ data: { email: `od-owner-${ts}@t.test`, fullName: 'Рустам Каримов' } })).id;
  opsId = (await prisma.user.create({ data: { email: `od-ops-${ts}@t.test`, fullName: 'Шерзод' } })).id;
  await prisma.userTenantRole.createMany({ data: [{ tenantId, userId: ownerUserId, role: 'PROPERTY_OWNER' }, { tenantId, userId: opsId, role: 'OPERATIONS_MANAGER' }] });
  const b = await createBuilding(ctx(['ADMIN']), { code: 'TOWER', name: 'Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 11 });
  const ownerId = (await createPropertyOwner(ctx(['COMMERCIAL_MANAGER']), { kind: 'PERSON', displayName: 'Рустам Каримов', managementConsent: true })).id;
  await prisma.propertyOwner.update({ where: { id: ownerId }, data: { userId: ownerUserId } });
  const other = (await createPropertyOwner(ctx(['COMMERCIAL_MANAGER']), { kind: 'PERSON', displayName: 'Другой' })).id;
  myUnit = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '1101', type: 'APARTMENT', areaM2: 80, ownerId, managedByPlatform: true })).id;
  otherUnit = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '1102', type: 'APARTMENT', areaM2: 80, ownerId: other })).id;
  const l1 = await createLease(ctx(['COMMERCIAL_MANAGER']), { unitId: myUnit, type: 'LTR', occupantName: 'CityNet', startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), rentMinor: 100_000n });
  await activateLease(ctx(['COMMERCIAL_MANAGER']), l1.id);
  myLease = l1.id;
  otherLease = (await createLease(ctx(['COMMERCIAL_MANAGER']), { unitId: otherUnit, type: 'LTR', occupantName: 'X', startAt: new Date('2026-01-01'), endAt: null, rentMinor: 1n })).id;
});
afterAll(async () => prisma.$disconnect());

describe('Owner Portal — документы по договорам и услуги (BR-P33, blueprint §10/§13)', () => {
  it('менеджер загружает договор к LeaseContract; собственник видит только свои документы и скачивает только их', async () => {
    await uploadDocument(ctx(['COMMERCIAL_MANAGER']), storage, { objectType: 'lease_contract', objectId: myLease, docType: 'CONTRACT', fileName: 'lease-1101.pdf', mime: 'application/pdf', body: Buffer.from('pdf-1') });
    const foreign = await uploadDocument(ctx(['COMMERCIAL_MANAGER']), storage, { objectType: 'lease_contract', objectId: otherLease, docType: 'CONTRACT', fileName: 'lease-1102.pdf', mime: 'application/pdf', body: Buffer.from('pdf-2') });
    expect((await listDocumentsFor(ctx(['COMMERCIAL_MANAGER']), 'lease_contract', myLease)).map((d) => d.fileName)).toEqual(['lease-1101.pdf']);
    const mine = await listOwnerDocuments(me());
    expect(mine.map((d) => [d.fileName, d.unitNo, d.mine])).toEqual([['lease-1101.pdf', '1101', false]]);
    await expect(getOwnerDocumentUrl(me(), storage, mine[0]!.id)).resolves.toMatch(/lease-1101\.pdf/);
    await expect(getOwnerDocumentUrl(me(), storage, foreign.id)).rejects.toThrow(NotFoundError);
    await expect(listOwnerDocuments(ctx(['COMMERCIAL_MANAGER']))).rejects.toThrow(PermissionDeniedError);
  });

  it('собственник загружает документ по своему юниту (без document.upload), не по чужому; только разрешённые типы; audit без содержимого', async () => {
    await expect(uploadDocument(me(), storage, { objectType: 'unit', objectId: myUnit, docType: 'POA', fileName: 'x.pdf', mime: 'application/pdf', body: Buffer.from('x') })).rejects.toThrow(PermissionDeniedError);
    const d = await uploadOwnerDocument(me(), storage, { objectType: 'unit', objectId: myUnit, docType: 'POA', fileName: 'доверенность.pdf', mime: 'application/pdf', body: Buffer.from('poa') });
    expect(d.uploadedBy).toBe(ownerUserId);
    expect(d.status).toBe('PENDING');
    await expect(uploadOwnerDocument(me(), storage, { objectType: 'unit', objectId: otherUnit, docType: 'POA', fileName: 'x.pdf', mime: 'application/pdf', body: Buffer.from('x') })).rejects.toThrow(NotFoundError);
    await expect(uploadOwnerDocument(me(), storage, { objectType: 'lease_contract', objectId: otherLease, docType: 'OTHER', fileName: 'x.pdf', mime: 'application/pdf', body: Buffer.from('x') })).rejects.toThrow(NotFoundError);
    await expect(uploadOwnerDocument(me(), storage, { objectType: 'unit', objectId: myUnit, docType: 'SF', fileName: 'x.pdf', mime: 'application/pdf', body: Buffer.from('x') })).rejects.toThrow(/DOC_TYPE_NOT_ALLOWED/);
    await expect(uploadOwnerDocument(me(), storage, { objectType: 'unit', objectId: myUnit, docType: 'OTHER', fileName: 'x.exe', mime: 'application/x-msdownload', body: Buffer.from('x') })).rejects.toThrow(/FILE_TYPE_NOT_ALLOWED/);
    const mine = await listOwnerDocuments(me());
    expect(mine.map((x) => [x.docType, x.mine])).toEqual([['POA', true], ['CONTRACT', false]]);
    const portal = await getOwnerPortal(me());
    expect(portal.documents).toHaveLength(2);
    const audit = await prisma.auditLog.findFirst({ where: { tenantId, objectType: 'document', objectId: d.id } });
    expect(audit?.action).toBe('document.upload');
    expect(JSON.stringify(audit?.after)).not.toContain('poa');
  });

  it('услуги: собственник заказывает из каталога только по своему юниту, видит свои заказы в портале, оценивает выполненный', async () => {
    const item = await createCatalogItem(ctx(['OPERATIONS_MANAGER'], opsId), { code: 'CLEAN-DEEP', name: 'Генеральная уборка', category: 'CLEANING', providerKind: 'OWN_OPS', priceMinor: 500_000_00n, slaHours: 24 });
    expect((await getOwnerPortal(me())).catalog.map((c) => c.code)).toEqual(['CLEAN-DEEP']);
    await expect(createOwnerServiceOrder(me(), { catalogItemId: item.id, unitId: otherUnit })).rejects.toThrow(NotFoundError);
    const o = await createOwnerServiceOrder(me(), { catalogItemId: item.id, unitId: myUnit, notes: 'после выезда' });
    expect(o.ownerId).not.toBeNull();
    expect(o.source).toBe('API');
    expect(o.status).toBe('NEW');
    await expect(rateOwnerServiceOrder(me(), o.id, 5)).rejects.toThrow(/NOT_DONE/);
    await transitionServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), o.id, 'start');
    await transitionServiceOrder(ctx(['OPERATIONS_MANAGER'], opsId), o.id, 'done');
    let portal = await getOwnerPortal(me());
    expect(portal.serviceOrders.map((x) => [x.number, x.status, x.canRate])).toEqual([[o.number, 'DONE', true]]);
    await expect(rateServiceOrder(ctx(['PROPERTY_OWNER']), o.id, 5)).rejects.toThrow(NotFoundError); // другой собственник
    await rateOwnerServiceOrder(me(), o.id, 5, 'отлично');
    portal = await getOwnerPortal(me());
    expect(portal.serviceOrders[0]!.rating).toBe(5);
    expect(portal.serviceOrders[0]!.canRate).toBe(false);
  });
});
