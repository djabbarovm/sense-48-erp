import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ValidationError, unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { getMyDay, quickCall, quickLead, scheduleViewing, taskDone, viewingResult } from '../src/services/myDay.js';
import { createBuilding, createFloor, createPropertyOwner, createUnit } from '../src/services/property.js';
import { setOwnerNextAction } from '../src/services/ownerPipeline.js';
import { createManualTask } from '../src/services/tasks.js';

let tenantId: string; let cmId: string; let otherCmId: string;
const ctx = (roles: RoleCode[] = ['COMMERCIAL_MANAGER'], userId = cmId) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'md', userId, roles });
const NOW = new Date('2026-09-19T05:00:00Z'); // 10:00 Ташкент

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-md-${ts}`, legalName: 'MD', taxId: '300000501', settings: {} } })).id;
  cmId = (await prisma.user.create({ data: { email: `md-cm-${ts}@t.test`, fullName: 'Менеджер' } })).id;
  otherCmId = (await prisma.user.create({ data: { email: `md-cm2-${ts}@t.test`, fullName: 'Коллега' } })).id;
  for (const u of [cmId, otherCmId]) await prisma.userTenantRole.create({ data: { tenantId, userId: u, role: 'COMMERCIAL_MANAGER' } });
  const b = await createBuilding(ctx(['ADMIN']), { code: 'MD', name: 'MD Tower', kind: 'TOWER' });
  const f = await createFloor(ctx(['ADMIN']), { buildingId: b.id, floorNo: 12 });
  await createUnit(ctx(), { floorId: f.id, unitNo: '1204', type: 'APARTMENT', areaM2: 75, askingRateMinor: 1_400_00n, askingCurrency: 'USD' } as never);
  const owner = await createPropertyOwner(ctx(), { kind: 'PERSON', displayName: 'Собственник' });
  await setOwnerNextAction(ctx(), owner.id, { nextAction: 'Позвонить', nextActionAt: new Date('2026-09-18T05:00:00Z'), managerId: cmId });
});
afterAll(async () => prisma.$disconnect());

describe('«Мой день» (docs/21 §5; BR-P60/P61)', () => {
  it('быстрый лид → NEW co следующим шагом через 15 минут и юнитом по номеру; чужой менеджер его не видит', async () => {
    const d = await quickLead(ctx(), { contactName: 'Алиев', contactPhone: '90 123 45 67', note: '2к до 1500, октябрь', unitNo: '1204', source: 'INSTAGRAM' }, NOW);
    expect([d.stage, d.nextAction, d.expectedRateMinor]).toEqual(['PROPERTY_SELECTED', 'Связаться c клиентом', 1_400_00n]);
    expect(d.nextActionAt?.toISOString()).toBe('2026-09-19T05:15:00.000Z');
    const mine = await getMyDay(ctx(), NOW);
    expect(mine.dueToday.map((x) => x.id)).toContain(d.id);
    expect(mine.today.leads).toBe(1);
    const colleague = await getMyDay(ctx(['COMMERCIAL_MANAGER'], otherCmId), NOW);
    expect(colleague.dueToday).toHaveLength(0);
    const boss = await getMyDay(ctx(['OWNER'], otherCmId), NOW);
    expect([boss.seesAll, boss.dueToday.length, boss.owners.length]).toEqual([true, 1, 1]);
    // ADR-038: комм. директор и CEO — надзор над всем коммерческим потоком (видят чужие сделки)
    const director = await getMyDay(ctx(['COMMERCIAL_DIRECTOR'], otherCmId), NOW);
    expect([director.seesAll, director.dueToday.map((x) => x.id).includes(d.id)]).toEqual([true, true]);
    const ceo = await getMyDay(ctx(['CEO'], otherCmId), NOW);
    expect(ceo.seesAll).toBe(true);
  });

  it('звонок → активность CALL и следующий шаг; показ → VIEWING c датой (в прошлое нельзя), стадия и «провести показ»', async () => {
    const d = (await getMyDay(ctx(), NOW)).dueToday[0]!;
    await quickCall(ctx(), d.id, { note: 'Уточнил бюджет', nextAction: 'Отправить подборку', nextActionAt: new Date('2026-09-20T05:00:00Z') }, NOW);
    await expect(scheduleViewing(ctx(), d.id, { at: new Date('2026-09-18T10:00:00Z') }, NOW)).rejects.toBeInstanceOf(ValidationError);
    const noUnit = await quickLead(ctx(), { contactName: 'Без юнита', contactPhone: '+998971112233' }, NOW);
    await expect(scheduleViewing(ctx(), noUnit.id, { at: new Date('2026-09-19T10:00:00Z') }, NOW)).rejects.toThrow(/DEAL_UNIT_REQUIRED/);
    await scheduleViewing(ctx(), noUnit.id, { at: new Date('2026-09-19T11:00:00Z'), unitNo: '1204' }, NOW);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: noUnit.id } })).stage).toBe('VIEWING');
    await scheduleViewing(ctx(), d.id, { at: new Date('2026-09-19T10:00:00Z') }, NOW); // сегодня 15:00
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: d.id } });
    expect([deal.stage, deal.nextAction]).toEqual(['VIEWING', 'Провести показ']);
    const day = await getMyDay(ctx(), NOW);
    expect(day.viewings).toHaveLength(2);
    expect([day.viewings[0]!.unitNo, day.viewings[0]!.done, day.today.calls, day.today.viewingsScheduled]).toEqual(['1204', false, 1, 2]);
  });

  it('результат показа: думает → follow-up; оффер → стадия OFFER c ожидаемой ставкой; отказ требует причину и закрывает сделку', async () => {
    const d = (await getMyDay(ctx(), NOW)).viewings[0]!;
    const later = new Date('2026-09-19T13:00:00Z');
    await viewingResult(ctx(), d.dealId, { result: 'THINKING', note: 'Понравилось, думают до понедельника', followUpAt: new Date('2026-09-22T05:00:00Z') }, later);
    let deal = await prisma.deal.findUniqueOrThrow({ where: { id: d.dealId } });
    expect([deal.stage, deal.nextAction, deal.nextActionAt?.toISOString().slice(0, 10)]).toEqual(['VIEWING', 'Перезвонить после показа', '2026-09-22']);
    await viewingResult(ctx(), d.dealId, { result: 'OFFER', expectedRateMinor: 1_350_00n }, later);
    deal = await prisma.deal.findUniqueOrThrow({ where: { id: d.dealId } });
    expect([deal.stage, deal.expectedRateMinor, deal.nextAction]).toEqual(['OFFER', 1_350_00n, 'Отправить оффер']);
    await expect(viewingResult(ctx(), d.dealId, { result: 'LOST' }, later)).rejects.toBeInstanceOf(ValidationError);
    await viewingResult(ctx(), d.dealId, { result: 'LOST', lostReason: 'PRICE', note: 'Дорого' }, later);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: d.dealId } })).stage).toBe('LOST');
    expect(await prisma.unitActivity.count({ where: { dealId: d.dealId } })).toBeGreaterThanOrEqual(5);
  });

  it('просроченный собственник и задача попадают в день; задача закрывается', async () => {
    const task = await createManualTask(ctx(['ADMIN']), { type: 'DEAL_FOLLOWUP', objectType: 'deal', objectId: tenantId, nextAction: 'Отправить КП', dueAt: new Date('2026-09-19T04:00:00Z'), ownerId: cmId });
    const day = await getMyDay(ctx(), NOW);
    expect(day.owners[0]).toMatchObject({ displayName: 'Собственник', overdue: true });
    expect(day.tasks.some((t) => t.id === task.id)).toBe(true);
    await taskDone(ctx(), task.id);
    expect((await getMyDay(ctx(), NOW)).tasks.some((t) => t.id === task.id)).toBe(false);
  });
});
