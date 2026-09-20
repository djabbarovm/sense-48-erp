import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createBuilding, createFloor, createUnit } from '../src/services/property.js';
import { createLease, activateLease } from '../src/services/leases.js';
import { recordHandover, getHandover, recordServicesHandoff, hasServicesHandoff } from '../src/services/handover.js';

let tenantId: string; let brokerId: string; let ccId: string; let unitId: string; let leaseId: string;
const ctx = (roles: RoleCode[], userId: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'hv', userId, roles });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-hv-${ts}`, legalName: 'HV', taxId: '300001001', settings: {} } })).id;
  brokerId = (await prisma.user.create({ data: { email: `hv-br-${ts}@t.test`, fullName: 'Азиз' } })).id;
  ccId = (await prisma.user.create({ data: { email: `hv-cc-${ts}@t.test`, fullName: 'Умар' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: brokerId, role: 'BROKER' } });
  await prisma.userTenantRole.create({ data: { tenantId, userId: ccId, role: 'CALL_CENTER' } });
  const b = await createBuilding(ctx(['ADMIN'], brokerId), { code: 'HV', name: 'HV Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN'], brokerId), { buildingId: b.id, floorNo: 2 });
  unitId = (await createUnit(ctx(['COMMERCIAL_MANAGER'], brokerId), { floorId: f.id, unitNo: '201', type: 'APARTMENT', areaM2: 50, askingRateMinor: 800_00n, askingCurrency: 'USD' } as never)).id;
  const lease = await createLease(ctx(['BROKER'], brokerId), { unitId, type: 'LTR', occupantName: 'Клиент', startAt: new Date('2026-09-01'), rentMinor: 800_00n, currency: 'USD' });
  leaseId = lease.id;
  await activateLease(ctx(['BROKER'], brokerId), leaseId);
});
afterAll(async () => prisma.$disconnect());

describe('Slice 5 — Handover / move-in package (docs/24 §8)', () => {
  it('брокер фиксирует пакет передачи (акт, фото, счётчики, ключи, карты, move-in); complete считается', async () => {
    const rec = await recordHandover(ctx(['BROKER'], brokerId), leaseId, {
      actSigned: true, conditionPhotos: 8, meters: 'эл 12345 / вода 678', keysCount: 3, accessCards: 2, moveInDate: new Date('2026-09-05'), passportOnFile: true, requisitesOnFile: true, note: 'передано',
    });
    expect(rec.complete).toBe(true);
    const got = await getHandover(ctx(['BROKER'], brokerId), unitId);
    expect(got).toMatchObject({ actSigned: true, conditionPhotos: 8, keysCount: 3, accessCards: 2, passportOnFile: true, complete: true });
  });

  it('protected docs — только признак наличия, без содержимого; детали пакета по праву lease.view', async () => {
    const got = await getHandover(ctx(['BROKER'], brokerId), unitId);
    // хранится только presence-флаг, а не номер/контент
    expect(JSON.stringify(got)).not.toMatch(/passport.*\d{6,}/i);
    // роль без lease.view не читает пакет
    await expect(getHandover(ctx(['MARKETING'], ccId), unitId)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('services handoff после move-in фиксируется и виден', async () => {
    expect(await hasServicesHandoff(ctx(['BROKER'], brokerId), unitId)).toBe(false);
    await recordServicesHandoff(ctx(['BROKER'], brokerId), leaseId, 'познакомил с Services');
    expect(await hasServicesHandoff(ctx(['BROKER'], brokerId), unitId)).toBe(true);
    expect(await prisma.domainEvent.count({ where: { tenantId, type: 'services.handoff' } })).toBe(1);
  });
});
