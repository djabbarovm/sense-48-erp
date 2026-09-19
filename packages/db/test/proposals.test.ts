import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { MockTelegramBotApi } from '@finance-os/adapters';
import { prisma } from '../src/client.js';
import { createProposal, getPublicProposal, listProposals, requestViewingFromProposal } from '../src/services/proposals.js';
import { sendCrmReminders } from '../src/services/telegramBot.js';
import { createDeal } from '../src/services/deals.js';
import { createBuilding, createFloor, createPropertyOwner, createUnit } from '../src/services/property.js';

let tenantId: string; let cmId: string; let u1: string; let u2: string; let dealId: string;
const ctx = (roles: RoleCode[] = ['COMMERCIAL_MANAGER']) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'pr', userId: cmId, roles });
const NOW = new Date('2026-09-21T06:00:00Z');

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-pr-${ts}`, legalName: 'ООО «Демо Тауэр»', taxId: '300000901', settings: {} } })).id;
  cmId = (await prisma.user.create({ data: { email: `pr-cm-${ts}@t.test`, fullName: 'Алия Менеджер', telegramChatId: `pr-${ts}` } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: cmId, role: 'COMMERCIAL_MANAGER' } });
  const b = await createBuilding(ctx(['ADMIN']), { code: 'PR', name: 'Demo Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 9 });
  const owner = await createPropertyOwner(ctx(), { kind: 'PERSON', displayName: 'Секретный Собственник', contactPhone: '+998900000000' });
  u1 = (await createUnit(ctx(), { floorId: f.id, unitNo: '901', type: 'APARTMENT', areaM2: 72, ownerId: owner.id, askingRateMinor: 1_300_00n, askingCurrency: 'USD' } as never)).id;
  u2 = (await createUnit(ctx(), { floorId: f.id, unitNo: '902', type: 'APARTMENT', areaM2: 58 } as never)).id;
  dealId = (await createDeal(ctx(), { contactName: 'Сардор Алиев', contactPhone: '+998901234567', unitId: u1 })).id;
});
afterAll(async () => prisma.$disconnect());

describe('Коммерческое предложение (P-28, docs/21 §3)', () => {
  it('создание: 1–6 помещений своего тенанта, активность OFFER и следующий шаг; ссылка c токеном', async () => {
    await expect(createProposal(ctx(), dealId, { unitIds: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createProposal(ctx(), dealId, { unitIds: ['00000000-0000-7000-8000-000000000000'] })).rejects.toBeInstanceOf(NotFoundError);
    const p = await createProposal(ctx(), dealId, { unitIds: [u1, u2], note: 'Заезд c 1 октября', validDays: 5 }, NOW);
    expect(p.token.length).toBeGreaterThanOrEqual(16);
    expect(p.validUntil?.toISOString().slice(0, 10)).toBe('2026-09-26');
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(deal.nextAction).toBe('Узнать реакцию на КП');
    expect(await prisma.unitActivity.count({ where: { dealId, kind: 'OFFER' } })).toBe(1);
    const list = await listProposals(ctx(), dealId);
    expect(list[0]?.unitNos).toEqual(['901', '902']);
    expect(list[0]?.url).toMatch(/\/p\//);
  });
  it('публичная выдача: только публичные поля (без собственника/арендатора), просмотры считаются; неизвестный токен — null', async () => {
    const { token } = (await listProposals(ctx(), dealId))[0]!;
    const pub = await getPublicProposal(token, NOW);
    expect(pub?.clientFirstName).toBe('Сардор');
    expect(pub?.managerName).toBe('Алия');
    expect(pub?.units.map((u) => [u.unitNo, u.areaM2, u.askingRateMinor, u.floorNo])).toEqual([['901', 72, 1_300_00n, 9], ['902', 58, null, 9]]);
    expect(JSON.stringify(pub, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toMatch(/Секретный|\+99890/);
    await getPublicProposal(token, NOW);
    const row = await prisma.dealProposal.findUniqueOrThrow({ where: { token } });
    expect([row.viewsCount, row.viewedAt?.toISOString()]).toEqual([2, NOW.toISOString()]);
    expect(await getPublicProposal('nope', NOW)).toBeNull();
  });
  it('запрос показа: один раз, активность и следующий шаг менеджеру; бот получает «открыл КП» и «запросил показ»', async () => {
    const { token } = (await listProposals(ctx(), dealId))[0]!;
    expect(await requestViewingFromProposal(token, { note: 'Удобно завтра после 18:00' }, NOW)).toBe(true);
    expect(await requestViewingFromProposal(token, {}, NOW)).toBe(false);
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
    expect(deal.nextAction).toBe('Назначить показ (запрос из КП)');
    const api = new MockTelegramBotApi();
    expect(await sendCrmReminders(tenantId, NOW, api)).toBeGreaterThanOrEqual(1);
    expect(api.sent.some((m) => /запросил показ по КП: «Удобно завтра после 18:00»/.test(m.text))).toBe(true);
    api.sent.length = 0;
    await sendCrmReminders(tenantId, NOW, api);
    expect(api.sent.some((m) => /КП/.test(m.text))).toBe(false); // уведомлено один раз
    // истёкшее КП: просмотр не считается, запрос отклоняется
    const late = new Date('2026-10-01T06:00:00Z');
    expect((await getPublicProposal(token, late))?.expired).toBe(true);
    expect(await requestViewingFromProposal(token, {}, late)).toBe(false);
  });
});
