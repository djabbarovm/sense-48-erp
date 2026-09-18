import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionDeniedError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { getControlRoom } from '../src/services/controlRoom.js';
import { createBuilding, createFloor, createPropertyOwner, createUnit, changeUnitStatus } from '../src/services/property.js';
import { createDeal } from '../src/services/deals.js';

let tenantId: string;
const ctx = (...roles: RoleCode[]) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'cr', userId: crypto.randomUUID(), roles });

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { slug: `t-cr-${Date.now()}`, legalName: 'CR', taxId: '300000041' } })).id;
  const b = await createBuilding(ctx('ADMIN'), { code: 'T', name: 'T', kind: 'TOWER' });
  const f = await createFloor(ctx('ADMIN'), { buildingId: b.id, floorNo: 1 });
  const owner = await createPropertyOwner(ctx('COMMERCIAL_MANAGER'), { kind: 'PERSON', displayName: 'Согласный Собственник', managementConsent: true });
  const u1 = await createUnit(ctx('COMMERCIAL_MANAGER'), { floorId: f.id, unitNo: '101', type: 'APARTMENT', areaM2: 50, ownerId: owner.id, askingRateMinor: 100_000n });
  await createUnit(ctx('COMMERCIAL_MANAGER'), { floorId: f.id, unitNo: '102', type: 'APARTMENT', areaM2: 60 });
  await changeUnitStatus(ctx('COMMERCIAL_MANAGER'), u1.id, { commercialStatus: 'AVAILABLE' });
  await changeUnitStatus(ctx('OPERATIONS_MANAGER'), u1.id, { operationalStatus: 'CRITICAL' });
  await createDeal(ctx('COMMERCIAL_MANAGER'), { contactName: 'Клиент', unitId: u1.id, expectedRateMinor: 90_000n }); // без nextAction → attention
});
afterAll(async () => prisma.$disconnect());

describe('Control Room (blueprint §9)', () => {
  it('собирает today/commercial/owners/operations из сервисов; PII по праву; 403 без property.view', async () => {
    const cr = await getControlRoom(ctx('COMMERCIAL_MANAGER'));
    expect(cr.today.newDeals).toBe(1);
    expect(cr.today.attentionDeals).toBe(1);
    expect(cr.today.criticalUnits).toBe(1);
    expect(cr.commercial.kpi.commercial).toBe(2);
    expect(cr.commercial.byBuilding).toHaveLength(1);
    expect(cr.commercial.pipeline?.totals.potentialMinor).toBe(90_000n);
    expect(cr.owners.consented).toBe(1);
    expect(cr.owners.consentedWithoutLease[0]?.displayName).toBe('Согласный Собственник');
    expect(cr.operations.critical).toBe(1);
    expect(cr.lists.attentionDeals).toHaveLength(1);
    const ops = await getControlRoom(ctx('OPERATIONS_MANAGER'));
    expect(ops.commercial.pipeline).toBeNull(); // нет deal.view
    expect(ops.owners.consentedWithoutLease[0]?.displayName).toBe('Согласный С.'); // маскирование
    await expect(getControlRoom(unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: 'u', roles: [] }))).rejects.toThrow(PermissionDeniedError);
  });
});
