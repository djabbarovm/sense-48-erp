import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createBuilding, createFloor, createUnit, setUnitPublished, changeUnitStatus } from '../src/services/property.js';
import { recordPriceDecision, requestMarketingMedia, markMediaReady, getListingStatus } from '../src/services/listing.js';

let tenantId: string; let brokerId: string; let unitId: string;
const ctx = (roles: RoleCode[], userId: string) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'lst', userId, roles });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-lst-${ts}`, legalName: 'LST', taxId: '300000901', settings: {} } })).id;
  brokerId = (await prisma.user.create({ data: { email: `lst-br-${ts}@t.test`, fullName: 'Азиз' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: brokerId, role: 'BROKER' } });
  const b = await createBuilding(ctx(['ADMIN'], brokerId), { code: 'LST', name: 'LST Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN'], brokerId), { buildingId: b.id, floorNo: 3 });
  unitId = (await createUnit(ctx(['COMMERCIAL_MANAGER'], brokerId), { floorId: f.id, unitNo: '301', type: 'APARTMENT', areaM2: 55, askingRateMinor: 800_00n, askingCurrency: 'USD' } as never)).id;
});
afterAll(async () => prisma.$disconnect());

describe('Slice 4 — Listing / fund workflow (docs/24 §3/§6)', () => {
  it('брокер фиксирует согласованную собственником цену — обновляет юнит и пишет историю (источник=OWNER)', async () => {
    const after = await recordPriceDecision(ctx(['BROKER'], brokerId), unitId, { askingRateMinor: 950_00n, source: 'OWNER', note: 'собственник согласовал' });
    expect(after.askingRateMinor).toBe(950_00n);
    const hist = await prisma.unitActivity.findFirst({ where: { unitId, note: { startsWith: 'PRICE:src=OWNER' } } });
    expect(hist).not.toBeNull();
  });

  it('Marketing handoff: запрос медиа → media ready → публикация; статус листинга отражает шаги', async () => {
    await requestMarketingMedia(ctx(['BROKER'], brokerId), unitId, 'нужна съёмка');
    await markMediaReady(ctx(['BROKER'], brokerId), unitId);
    await changeUnitStatus(ctx(['BROKER'], brokerId), unitId, { commercialStatus: 'AVAILABLE' });
    await setUnitPublished(ctx(['BROKER'], brokerId), unitId, true);
    const st = await getListingStatus(ctx(['BROKER'], brokerId), unitId);
    expect([st.mediaRequested, st.mediaReady, st.published]).toEqual([true, true, true]);
    expect(st.priceHistory.length).toBeGreaterThanOrEqual(1);
    expect(st.daysOnMarket).not.toBeNull();
    // outbox-события маркетинга записаны
    expect(await prisma.domainEvent.count({ where: { tenantId, type: { in: ['marketing.media.requested', 'marketing.media.ready'] } } })).toBe(2);
  });

  it('stale listing: опубликован и без свежей активности → stale=true (порог staleDays)', async () => {
    // сдвигаем активности в прошлое (> staleDays)
    await prisma.unitActivity.updateMany({ where: { unitId }, data: { happenedAt: new Date(Date.now() - 60 * 86_400_000) } });
    const st = await getListingStatus(ctx(['BROKER'], brokerId), unitId);
    expect(st.stale).toBe(true);
  });
});
