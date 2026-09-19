import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PermissionDeniedError, ValidationError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createDeal, moveDeal, updateDeal } from '../src/services/deals.js';
import { getMyDay, quickLead, scheduleViewing } from '../src/services/myDay.js';
import { addOwnerActivity, moveOwnerStage } from '../src/services/ownerPipeline.js';
import { createBuilding, createFloor, createPropertyOwner, createUnit } from '../src/services/property.js';

let tenantId: string; let ccId: string; let cmId: string; let ownerId: string;
const ctx = (roles: RoleCode[], userId: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'cc', userId, roles });
const NOW = new Date('2026-09-21T05:00:00Z');

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-cc-${ts}`, legalName: 'CC', taxId: '300000701', settings: {} } })).id;
  ccId = (await prisma.user.create({ data: { email: `cc-${ts}@t.test`, fullName: 'Колл Центр' } })).id;
  cmId = (await prisma.user.create({ data: { email: `cc-cm-${ts}@t.test`, fullName: 'Менеджер' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: cmId, role: 'COMMERCIAL_MANAGER' } });
  await prisma.userTenantRole.create({ data: { tenantId, userId: ccId, role: 'CALL_CENTER' } });
  const b = await createBuilding(ctx(['ADMIN'], cmId), { code: 'CC', name: 'CC Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN'], cmId), { buildingId: b.id, floorNo: 4 });
  ownerId = (await createPropertyOwner(ctx(['COMMERCIAL_MANAGER'], cmId), { kind: 'PERSON', displayName: 'Собственник' })).id;
  await createUnit(ctx(['COMMERCIAL_MANAGER'], cmId), { floorId: f.id, unitNo: '401', type: 'APARTMENT', areaM2: 60, ownerId, askingRateMinor: 900_00n, askingCurrency: 'USD' } as never);
});
afterAll(async () => prisma.$disconnect());

describe('Роль CALL_CENTER (docs/21 §1; BR-P62)', () => {
  it('лид от КЦ назначается дежурному менеджеру, а не КЦ; КЦ видит всю входящую очередь', async () => {
    const d = await quickLead(ctx(['CALL_CENTER'], ccId), { contactName: 'Входящий', contactPhone: '+998901000010', source: 'WALK_IN' }, NOW);
    expect(d.managerId).toBe(cmId);
    expect(d.createdBy).toBe(ccId);
    const day = await getMyDay(ctx(['CALL_CENTER'], ccId), NOW);
    expect([day.seesAll, day.dueToday.some((x) => x.id === d.id)]).toEqual([true, true]);
    await updateDeal(ctx(['CALL_CENTER'], ccId), d.id, { managerId: cmId }); // передача менеджеру разрешена
  });
  it('КЦ доводит до показа, дальше стадия блокируется (CALL_CENTER_STAGE_LIMIT); менеджер продолжает', async () => {
    const d = await createDeal(ctx(['CALL_CENTER'], ccId), { contactName: 'Показной', contactPhone: '+998901000011' });
    await scheduleViewing(ctx(['CALL_CENTER'], ccId), d.id, { at: new Date('2026-09-22T10:00:00Z'), unitNo: '401' }, NOW);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: d.id } })).stage).toBe('VIEWING');
    await expect(moveDeal(ctx(['CALL_CENTER'], ccId), d.id, 'advance', {}, NOW)).rejects.toThrow(/CALL_CENTER_STAGE_LIMIT/);
    await moveDeal(ctx(['COMMERCIAL_MANAGER'], cmId), d.id, 'advance', {}, NOW);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: d.id } })).stage).toBe('OFFER');
  });
  it('собственники: КЦ пишет звонок и follow-up (owner.activity), но не двигает стадию вручную', async () => {
    await addOwnerActivity(ctx(['CALL_CENTER'], ccId), ownerId, { kind: 'CALL', note: 'Первичный контакт', followUpAt: new Date('2026-09-23T05:00:00Z') }, NOW);
    const o = await prisma.propertyOwner.findUniqueOrThrow({ where: { id: ownerId } });
    expect([o.pipelineStage, o.managerId]).toEqual(['CONTACTED', ccId]);
    await expect(moveOwnerStage(ctx(['CALL_CENTER'], ccId), ownerId, 'CONSENT')).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(addOwnerActivity(ctx(['ACCOUNTANT'], cmId), ownerId, { kind: 'NOTE', note: 'x' })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(createDeal(ctx(['CALL_CENTER'], ccId), { contactName: '' })).rejects.toBeInstanceOf(ValidationError);
  });
});
