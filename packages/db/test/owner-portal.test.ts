import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createOwnerRequest, getOwnerPortal, linkOwnerUser, listOwnersAdmin, updateOwnerConsents } from '../src/services/ownerPortal.js';
import { createBuilding, createFloor, createPropertyOwner, createUnit, getStatusMap, getUnitCard, setUnitPublished, changeUnitStatus } from '../src/services/property.js';
import { activateLease, createLease } from '../src/services/leases.js';
import { createWorkOrder } from '../src/services/workOrders.js';

let tenantId: string;
let ownerUserId: string;
let ownerId: string;
let myUnit: string;
let otherUnit: string;
const ctx = (roles: RoleCode[], userId?: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'op', userId: userId ?? crypto.randomUUID(), roles });
const me = () => ctx(['PROPERTY_OWNER'], ownerUserId);

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-op-${ts}`, legalName: 'OP', taxId: '300000071', settings: { management_fee_bp: 1500 } } })).id;
  ownerUserId = (await prisma.user.create({ data: { email: `owner-${ts}@t.test`, fullName: 'Рустам Каримов' } })).id;
  const b = await createBuilding(ctx(['ADMIN']), { code: 'TOWER', name: 'Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 9 });
  ownerId = (await createPropertyOwner(ctx(['COMMERCIAL_MANAGER']), { kind: 'PERSON', displayName: 'Рустам Каримов', managementConsent: true })).id;
  const other = (await createPropertyOwner(ctx(['COMMERCIAL_MANAGER']), { kind: 'PERSON', displayName: 'Другой Собственник' })).id;
  myUnit = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '901', type: 'APARTMENT', areaM2: 80, ownerId, managedByPlatform: true, askingRateMinor: 100_000n })).id;
  otherUnit = (await createUnit(ctx(['COMMERCIAL_MANAGER']), { floorId: f.id, unitNo: '902', type: 'APARTMENT', areaM2: 80, ownerId: other })).id;
  const lease = await createLease(ctx(['COMMERCIAL_MANAGER']), { unitId: myUnit, type: 'LTR', occupantName: 'CityNet', startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), rentMinor: 100_000n, depositMinor: 100_000n, depositReceived: true });
  await activateLease(ctx(['COMMERCIAL_MANAGER']), lease.id);
});
afterAll(async () => prisma.$disconnect());

describe('Wave 4b — Owner Portal (BR-P33)', () => {
  it('без привязки — OWNER_NOT_LINKED; привязка по email даёт роль; чужой email/занятый — ошибки', async () => {
    await expect(getOwnerPortal(me())).rejects.toThrow(NotFoundError);
    await expect(linkOwnerUser(ctx(['BROKER']), ownerId, 'x@t.test')).rejects.toThrow(PermissionDeniedError);
    await expect(linkOwnerUser(ctx(['COMMERCIAL_MANAGER']), ownerId, 'nobody@t.test')).rejects.toThrow(/USER_NOT_FOUND/);
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: ownerUserId } })).email;
    await linkOwnerUser(ctx(['COMMERCIAL_MANAGER']), ownerId, email);
    expect(await prisma.userTenantRole.count({ where: { tenantId, userId: ownerUserId, role: 'PROPERTY_OWNER' } })).toBe(1);
    const admin = await listOwnersAdmin(ctx(['COMMERCIAL_MANAGER']));
    expect(admin.find((o) => o.id === ownerId)?.userEmail).toBe(email);
  });

  it('собственник видит только свои юниты, договор, выписку c комиссией; здание и чужие юниты — недоступны', async () => {
    const p = await getOwnerPortal(me());
    expect(p.units.map((u) => u.unitNo)).toEqual(['901']);
    expect(p.units[0]?.lease?.rentMinor).toBe(100_000n);
    expect(p.units[0]?.color).toBe('GREEN');
    expect(p.feeBp).toBe(1500);
    expect(p.statement[0]).toMatchObject({ unitNo: '901', rentMinor: 100_000n, feeMinor: 15_000n, payoutMinor: 85_000n, managed: true });
    expect(p.totals.payout).toBe(85_000n);
    await expect(getStatusMap(me())).rejects.toThrow(PermissionDeniedError);
    await expect(getUnitCard(me(), myUnit)).rejects.toThrow(PermissionDeniedError);
    await expect(changeUnitStatus(me(), myUnit, { readiness: 'RENOVATION' })).rejects.toThrow(PermissionDeniedError);
    await expect(setUnitPublished(me(), myUnit, true)).rejects.toThrow(PermissionDeniedError);
  });

  it('заявка собственника — только по своему юниту (чужой → 404), приоритет не выше HIGH, source API; согласия c audit', async () => {
    await expect(createOwnerRequest(me(), { unitId: otherUnit, category: 'PLUMBING', title: 'x' })).rejects.toThrow(NotFoundError);
    await expect(createWorkOrder(me(), { unitId: otherUnit, category: 'PLUMBING', title: 'x' })).rejects.toThrow(NotFoundError);
    const wo = await createWorkOrder(me(), { unitId: myUnit, category: 'ELECTRICAL', title: 'Нет света в прихожей', priority: 'CRITICAL' });
    expect(wo.priority).toBe('HIGH');
    expect(wo.source).toBe('API');
    expect(wo.reporterId).toBe(ownerUserId);
    const p = await getOwnerPortal(me());
    expect(p.requests[0]?.number).toBe(wo.number);
    expect(p.units[0]?.openWorkOrders).toBe(1);
    const updated = await updateOwnerConsents(me(), { listingConsent: true, marketingConsent: false });
    expect(updated.listingConsent).toBe(true);
    expect(updated.consentUpdatedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { tenantId, action: 'property_owner.consents', objectId: ownerId } })).toBe(1);
    await expect(updateOwnerConsents(ctx(['BROKER']), { listingConsent: true })).rejects.toThrow(PermissionDeniedError);
  });

  it('отвязка снимает роль; пользователь другого tenant не видит портал', async () => {
    await linkOwnerUser(ctx(['COMMERCIAL_MANAGER']), ownerId, null);
    expect(await prisma.userTenantRole.count({ where: { tenantId, userId: ownerUserId, role: 'PROPERTY_OWNER' } })).toBe(0);
    await expect(getOwnerPortal(me())).rejects.toThrow(NotFoundError);
  });
});
