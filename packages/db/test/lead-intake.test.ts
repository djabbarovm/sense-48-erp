import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { intakeLead } from '../src/services/leadIntake.js';
import { getFunnelAnalytics } from '../src/services/dealAnalytics.js';
import { createBuilding, createFloor, createUnit, changeUnitStatus, getUnitCard } from '../src/services/property.js';
import { getDeal, listDeals, moveDeal } from '../src/services/deals.js';

let tenantId: string;
let cmId: string;
let unitId: string;
const ctx = (roles: RoleCode[], userId?: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'li', userId: userId ?? crypto.randomUUID(), roles });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-li-${ts}`, legalName: 'LI', taxId: '300000081' } })).id;
  cmId = (await prisma.user.create({ data: { email: `li-${ts}@t.test`, fullName: 'Алия' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: cmId, role: 'COMMERCIAL_MANAGER' } });
  const b = await createBuilding(ctx(['ADMIN']), { code: 'TOWER', name: 'Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 11 });
  unitId = (await createUnit(ctx(['COMMERCIAL_MANAGER'], cmId), { floorId: f.id, unitNo: '1101', type: 'APARTMENT', areaM2: 80, askingRateMinor: 150_000n })).id;
  await changeUnitStatus(ctx(['COMMERCIAL_MANAGER'], cmId), unitId, { commercialStatus: 'AVAILABLE' });
});
afterAll(async () => prisma.$disconnect());

describe('P-17 лиды c сайта и аналитика (BR-P34)', () => {
  it('лид c юнитом → сделка PROPERTY_SELECTED дежурному менеджеру c UTM; статус юнита пересчитан; PII не в audit', async () => {
    const r = await intakeLead(tenantId, { contactName: 'Дилноза Юсупова', contactPhone: '+998 90 123-45-67', unitNo: '1101', message: 'Хочу посмотреть', utm: { utm_source: 'instagram', utm_campaign: 'sept' }, page: '/residence/1101' });
    expect(r.created).toBe(true);
    const d = await getDeal(ctx(['COMMERCIAL_MANAGER'], cmId), r.dealId);
    expect(d.deal.stage).toBe('PROPERTY_SELECTED');
    expect(d.deal.managerId).toBe(cmId);
    expect(d.deal.contactPhone).toBe('+998901234567');
    expect(d.deal.source).toBe('WEBSITE');
    expect(d.deal.expectedRateMinor).toBe(150_000n);
    expect(d.deal.activities[0]?.note).toMatch(/utm_campaign=sept/);
    expect((await getUnitCard(ctx(['COMMERCIAL_MANAGER'], cmId), unitId)).unit.commercialStatus).toBe('AVAILABLE'); // PROPERTY_SELECTED не меняет overlay
    const audit = await prisma.auditLog.findMany({ where: { tenantId, objectId: r.dealId }, select: { after: true } });
    expect(JSON.stringify(audit)).not.toContain('998901234567');
  });

  it('BR-P34: повторное обращение по тому же телефону → активность в существующую сделку, а не дубликат', async () => {
    const r = await intakeLead(tenantId, { contactName: 'Дилноза', contactPhone: '998901234567', message: 'ещё раз' });
    expect(r.created).toBe(false);
    expect((await listDeals(ctx(['COMMERCIAL_MANAGER'], cmId))).length).toBe(1);
    const d = await getDeal(ctx(['COMMERCIAL_MANAGER'], cmId), r.dealId);
    expect(d.deal.activities.some((a) => a.note.startsWith('Повторное обращение'))).toBe(true);
    expect(d.deal.nextAction).toMatch(/Перезвонить/);
  });

  it('валидация: без контакта, плохой телефон, email; аналитика воронки по источникам и причинам', async () => {
    await expect(intakeLead(tenantId, { contactName: 'x' })).rejects.toThrow(/CONTACT_CHANNEL_REQUIRED/);
    await expect(intakeLead(tenantId, { contactName: 'x', contactPhone: 'abc' })).rejects.toThrow(/PHONE_INVALID/);
    await expect(intakeLead(tenantId, { contactName: 'x', contactEmail: 'nope' })).rejects.toThrow(/EMAIL_INVALID/);
    const r2 = await intakeLead(tenantId, { contactName: 'Компания', contactEmail: 'ceo@company.test', source: 'TELEGRAM', budgetMinor: 90_000n });
    await moveDeal(ctx(['COMMERCIAL_MANAGER'], cmId), r2.dealId, 'lose', { lostReason: 'PRICE' });
    const a = await getFunnelAnalytics(ctx(['COMMERCIAL_MANAGER'], cmId), 30);
    expect(a.totals.leads).toBe(2);
    expect(a.totals.lost).toBe(1);
    expect(a.bySource.find((s) => s.source === 'TELEGRAM')?.lost).toBe(1);
    expect(a.lostReasons[0]).toMatchObject({ reason: 'PRICE', count: 1, potentialMinor: 90_000n });
    expect(a.utmCampaigns[0]).toMatchObject({ campaign: 'sept', leads: 1 });
    expect(a.byStage.find((s) => s.stage === 'PROPERTY_SELECTED')?.count).toBe(1);
  });
});
