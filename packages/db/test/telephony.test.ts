import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { GenericTelephonyAdapter } from '@finance-os/adapters';
import { prisma } from '../src/client.js';
import { ingestCallEvent } from '../src/services/telephony.js';
import { getCrmAnalytics } from '../src/services/crmAnalytics.js';
import { createDeal } from '../src/services/deals.js';
import { createPropertyOwner } from '../src/services/property.js';
import { quickCall } from '../src/services/myDay.js';

let tenantId: string; let cmId: string;
const ctx = (roles: RoleCode[] = ['COMMERCIAL_MANAGER']) => unsafeCreateTenantContext({ tenantId, tenantSlug: 'tel', userId: cmId, roles });
const NOW = new Date('2026-09-21T06:00:00Z');
const ev = (o: Partial<Parameters<typeof ingestCallEvent>[1]>) => ({ kind: 'CALL_FINISHED' as const, externalId: `c-${Math.random()}`, direction: 'IN' as const, clientPhone: '+998 90 555 00 01', employeeExt: null, startedAt: NOW.toISOString(), durationSec: 180, recordingUrl: 'https://pbx.example/rec/1.mp3', ...o });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (await prisma.tenant.create({ data: { slug: `t-tel-${ts}`, legalName: 'TEL', taxId: '300000801', settings: {} } })).id;
  cmId = (await prisma.user.create({ data: { email: `tel-cm-${ts}@t.test`, fullName: 'Менеджер' } })).id;
  await prisma.userTenantRole.create({ data: { tenantId, userId: cmId, role: 'COMMERCIAL_MANAGER' } });
});
afterAll(async () => prisma.$disconnect());

describe('Телефония → CRM (docs/21 §7)', () => {
  it('адаптер разбирает нормализованный webhook; неизвестный тип игнорируется', () => {
    const a = new GenericTelephonyAdapter();
    expect(a.parseWebhook({ event: 'hangup', call_id: 'x1', phone: '+998905550001', direction: 'inbound', duration: '95', recording_url: 'https://r/1' })).toMatchObject({ kind: 'CALL_FINISHED', externalId: 'x1', direction: 'IN', durationSec: 95 });
    expect(a.parseWebhook({ event: 'missed', id: 'x2', phone: '905550001' })).toMatchObject({ kind: 'CALL_MISSED', durationSec: 0 });
    expect(a.parseWebhook({ event: 'ping' })).toBeNull();
  });
  it('неизвестный входящий → лид «Входящий …» c активностью CALL (PHONE) и шагом; повтор по externalId — DUPLICATE; исходящий на незнакомый — IGNORED', async () => {
    const e = ev({ externalId: 'call-1' });
    const r = await ingestCallEvent(tenantId, e, NOW);
    expect(r.status).toBe('NEW_LEAD');
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: r.dealId! } });
    expect([deal.contactPhone, deal.stage, deal.source]).toEqual(['+998905550001', 'NEW', 'OTHER']);
    const act = await prisma.unitActivity.findFirstOrThrow({ where: { dealId: deal.id } });
    expect([act.source, act.durationSec, act.callDirection, act.recordingUrl, act.externalRef]).toEqual(['PHONE', 180, 'IN', 'https://pbx.example/rec/1.mp3', 'call-1']);
    expect((await ingestCallEvent(tenantId, e, NOW)).status).toBe('DUPLICATE');
    expect((await ingestCallEvent(tenantId, ev({ direction: 'OUT', clientPhone: '+998907770000' }), NOW)).status).toBe('IGNORED');
  });
  it('знакомый клиент → активность в его активной сделке; пропущенный → следующий шаг «перезвонить»; собственник по телефону → активность у собственника', async () => {
    const r = await ingestCallEvent(tenantId, ev({ kind: 'CALL_MISSED', durationSec: 0, recordingUrl: null }), NOW);
    expect(r.status).toBe('DEAL_ACTIVITY');
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: r.dealId! } });
    expect(deal.nextAction).toMatch(/Перезвонить/);
    const owner = await createPropertyOwner(ctx(), { kind: 'PERSON', displayName: 'Собственник Тел', contactPhone: '+998 93 111 22 33' });
    const ro = await ingestCallEvent(tenantId, ev({ clientPhone: '93 111 22 33', direction: 'OUT' }), NOW);
    expect([ro.status, ro.ownerId]).toEqual(['OWNER_ACTIVITY', owner.id]);
  });
  it('аналитика CRM: скорость первого касания, объём по сотруднику, звонки из телефонии', async () => {
    const d = await createDeal(ctx(), { contactName: 'Быстрый', contactPhone: '+998901234000', source: 'WEBSITE' });
    await prisma.deal.update({ where: { id: d.id }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } }); // активность звонка пишется реальным now
    await quickCall(ctx(), d.id, { note: 'Ответил за 10 минут' });
    const a = await getCrmAnalytics(ctx(), 30, new Date(Math.max(Date.now(), NOW.getTime()) + 60_000));
    expect(a.speed.leads).toBeGreaterThanOrEqual(2);
    const web = a.speed.bySource.find((s) => s.source === 'WEBSITE')!;
    expect([web.leads, web.medianMinutes != null && web.medianMinutes <= 11, web.within15Pct]).toEqual([1, true, 100]);
    expect(a.calls.phone).toBe(3);
    expect(a.calls.missed).toBe(1);
    expect(a.calls.inbound).toBe(2);
    const me = a.staff.find((s) => s.userId === cmId)!;
    expect(me.calls).toBeGreaterThanOrEqual(3);
    expect(a.funnel.leads).toBe(a.speed.leads);
  });
});
