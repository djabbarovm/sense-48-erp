import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { MockTelegramBotApi } from '@finance-os/adapters';
import { prisma } from '../src/client.js';
import { contextForChat, handleTelegramUpdate, issueTelegramLinkCode, sendCrmDigests, sendCrmReminders } from '../src/services/telegramBot.js';
import { createBuilding, createFloor, createUnit } from '../src/services/property.js';
import { quickLead } from '../src/services/myDay.js';

let tenantId: string; let cmId: string; let ownerUserId: string;
const CHAT = '777001'; const OWNER_CHAT = '777002';
const ctx = (roles: RoleCode[] = ['COMMERCIAL_MANAGER'], userId = cmId) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'tg', userId, roles });
const NOW = new Date('2026-09-21T05:00:00Z'); // понедельник 10:00 Ташкент
const msg = (text: string, chat = CHAT) => ({ message: { message_id: 1, text, chat: { id: chat } } });
const cb = (data: string, chat = CHAT) => ({ callback_query: { id: 'cb1', data, message: { chat: { id: chat } }, from: { id: 1 } } });

beforeAll(async () => {
  const ts = Date.now();
  await prisma.user.updateMany({ where: { telegramChatId: { in: [CHAT, OWNER_CHAT] } }, data: { telegramChatId: null } }); // чаты из прошлых прогонов
  tenantId = (await prisma.tenant.create({ data: { slug: `t-tg-${ts}`, legalName: 'TG', taxId: '300000601', settings: {} } })).id;
  cmId = (await prisma.user.create({ data: { email: `tg-cm-${ts}@t.test`, fullName: 'Малика Менеджер' } })).id;
  ownerUserId = (await prisma.user.create({ data: { email: `tg-owner-${ts}@t.test`, fullName: 'Мурад Владелец', telegramChatId: OWNER_CHAT } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: cmId, role: 'COMMERCIAL_MANAGER' } });
  await prisma.userTenantRole.create({ data: { tenantId, userId: ownerUserId, role: 'OWNER' } });
  const b = await createBuilding(ctx(['ADMIN']), { code: 'TG', name: 'TG Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 12 });
  await createUnit(ctx(), { floorId: f.id, unitNo: '1204', type: 'APARTMENT', areaM2: 75, askingRateMinor: 1_400_00n, askingCurrency: 'USD' } as never);
});
afterAll(async () => prisma.$disconnect());

describe('Telegram-бот сотрудника (docs/21 §6; BR-P59/P60)', () => {
  it('привязка: без кода — инструкция; неверный код — отказ; /start <код> → чат привязан, контекст сотрудника', async () => {
    const api = new MockTelegramBotApi();
    await handleTelegramUpdate(msg('/start'), api, NOW);
    expect(api.sent.at(-1)?.text).toMatch(/Подключить Telegram/);
    await handleTelegramUpdate(msg('/start NOPE1234'), api, NOW);
    expect(api.sent.at(-1)?.text).toMatch(/не найден/);
    await handleTelegramUpdate(msg('показ 1204 завтра 15:00'), api, NOW);
    expect(api.sent.at(-1)?.text).toMatch(/не привязан/);
    const code = await issueTelegramLinkCode(cmId);
    await handleTelegramUpdate(msg(`/start ${code}`), api, NOW);
    expect(api.sent.at(-1)?.text).toMatch(/Готово, Малика/);
    expect((await contextForChat(CHAT))?.userId).toBe(cmId);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: cmId } })).telegramLinkCode).toBeNull();
  });

  it('лид текстом → черновик c кнопками → подтверждение → сделка; /today — дайджест c лидом', async () => {
    const api = new MockTelegramBotApi();
    await handleTelegramUpdate(msg('лид +998 90 123 45 67 Алиев Сардор, 2к до 1500, юнит 1204'), api, NOW);
    const draftMsg = api.sent.at(-1)!;
    expect(draftMsg.text).toMatch(/Создать лид: Алиев Сардор, \+998901234567, юнит 1204/);
    const confirm = draftMsg.keyboard![0]![0]!.data;
    expect(confirm).toMatch(/^d:c:/);
    await handleTelegramUpdate(cb(confirm), api, NOW);
    expect(api.sent.at(-1)?.text).toMatch(/✅ Сделано/);
    expect(api.callbacks).toEqual(['cb1']);
    const deal = await prisma.deal.findFirstOrThrow({ where: { tenantId, contactName: 'Алиев Сардор' } });
    expect([deal.stage, deal.source, deal.contactPhone]).toEqual(['PROPERTY_SELECTED', 'TELEGRAM', '+998901234567']);
    await handleTelegramUpdate(msg('/today'), api, NOW);
    expect(api.sent.at(-1)?.text).toMatch(/Мой день/);
    expect(api.sent.at(-1)?.text).toMatch(/Алиев Сардор/);
  });

  it('показ текстом → напоминание за час (дедуп) → через 2 ч вопрос c кнопками → кнопка «Думают» ставит follow-up', async () => {
    const api = new MockTelegramBotApi();
    await handleTelegramUpdate(msg('показ 1204 сегодня 15:00 Алиев'), api, NOW);
    await handleTelegramUpdate(cb(api.sent.at(-1)!.keyboard![0]![0]!.data), api, NOW);
    const deal = await prisma.deal.findFirstOrThrow({ where: { tenantId, contactName: 'Алиев Сардор' } });
    expect([deal.stage, deal.nextAction]).toEqual(['VIEWING', 'Провести показ']);
    const t1420 = new Date('2026-09-21T09:20:00Z');
    expect(await sendCrmReminders(tenantId, t1420, api)).toBe(1);
    expect(api.sent.at(-1)?.text).toMatch(/Через час показ: 15:00 · 1204 · Алиев Сардор/);
    expect(await sendCrmReminders(tenantId, new Date('2026-09-21T09:35:00Z'), api)).toBe(0); // дедуп
    const t1730 = new Date('2026-09-21T12:30:00Z');
    expect(await sendCrmReminders(tenantId, t1730, api)).toBe(1);
    const prompt = api.sent.at(-1)!;
    expect(prompt.text).toMatch(/Как прошёл показ 1204/);
    expect(prompt.keyboard![0]!.map((b) => b.text)).toEqual(['👍 Оффер', '🤔 Думают', '📅 Перенос', '✖ Отказ']);
    await handleTelegramUpdate(cb(prompt.keyboard![0]![1]!.data), api, t1730);
    const after = await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect([after.stage, after.nextAction]).toEqual(['VIEWING', 'Перезвонить после показа']);
    expect(await sendCrmReminders(tenantId, new Date('2026-09-21T13:00:00Z'), api)).toBe(0); // вопрос не повторяется
    // отказ через кнопки → причина → LOST
    await handleTelegramUpdate(cb(`v:${deal.id}:LOST`), api, t1730);
    expect(api.sent.at(-1)?.text).toMatch(/Причина отказа/);
    await handleTelegramUpdate(cb(`vl:${deal.id}:PRICE`), api, t1730);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stage).toBe('LOST');
  });

  it('SLA лида (BR-P59): 15 мин без касания → менеджеру, 30 мин → руководителю; вне рабочего времени тихо; дайджесты уходят подключённым', async () => {
    const api = new MockTelegramBotApi();
    const lead = await quickLead(ctx(), { contactName: 'Ночной Лид', contactPhone: '+998971110000', source: 'WEBSITE' }, new Date('2026-09-21T04:00:00Z'));
    await prisma.deal.update({ where: { id: lead.id }, data: { stage: 'NEW', createdAt: new Date('2026-09-21T04:00:00Z') } });
    await prisma.unitActivity.deleteMany({ where: { dealId: lead.id } });
    expect(await sendCrmReminders(tenantId, new Date('2026-09-20T22:00:00Z'), api)).toBe(0); // 03:00 Ташкент — тихо
    expect(await sendCrmReminders(tenantId, new Date('2026-09-21T04:20:00Z'), api)).toBe(1);
    expect(api.sent.at(-1)).toMatchObject({ chatId: CHAT });
    expect(api.sent.at(-1)?.text).toMatch(/Лид без ответа 20 мин: Ночной Лид/);
    expect(await sendCrmReminders(tenantId, new Date('2026-09-21T04:35:00Z'), api)).toBe(1); // эскалация владельцу
    expect(api.sent.at(-1)).toMatchObject({ chatId: OWNER_CHAT });
    expect(api.sent.at(-1)?.text).toMatch(/🚨 Лид Ночной Лид без касания 35 мин/);
    expect(await sendCrmReminders(tenantId, new Date('2026-09-21T04:50:00Z'), api)).toBe(0);
    expect(await sendCrmDigests(tenantId, NOW, api, 'morning')).toBe(2);
    expect(api.sent.at(-1)?.text).toMatch(/Доброе утро/);
    expect(await sendCrmDigests(tenantId, NOW, api, 'evening')).toBe(2);
    expect(api.sent.at(-1)?.text).toMatch(/Итог дня/);
  });
});
