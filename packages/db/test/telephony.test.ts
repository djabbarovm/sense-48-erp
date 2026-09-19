import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext, type RoleCode } from '@finance-os/core';
import { GenericTelephonyAdapter, buildTelephonyAdapter } from '@finance-os/adapters';
import { PermissionDeniedError, ValidationError } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { getTelephonySettings, ingestCallEvent, noteTelephonyWebhook, updateTelephonySettings } from '../src/services/telephony.js';
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

  it('P-29: настройки телефонии — только tenant.settings (ADMIN); email внутреннего номера → userId; чужой email → EXT_USER_NOT_FOUND; аудит', async () => {
    const admin = ctx(['ADMIN']);
    await expect(updateTelephonySettings(ctx(['COMMERCIAL_MANAGER']), { provider: 'onlinepbx', tzOffset: '+05:00', internalExtLen: 3, extMap: {} })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(updateTelephonySettings(admin, { provider: 'onlinepbx', tzOffset: '+05:00', internalExtLen: 3, extMap: { '101': 'nobody@else.test' } })).rejects.toBeInstanceOf(ValidationError);
    const cmEmail = (await prisma.user.findUniqueOrThrow({ where: { id: cmId } })).email!;
    const saved = await updateTelephonySettings(admin, { provider: 'onlinepbx', tzOffset: '+03:00', internalExtLen: 3, extMap: { '101': cmEmail }, fieldMap: { id: ['callid'] } });
    expect([saved.provider, saved.tzOffset, saved.internalExtLen, saved.extMap['101'], saved.fieldMap?.id]).toEqual(['onlinepbx', '+03:00', 3, cmId, ['callid']]);
    const audit = await prisma.auditLog.findFirst({ where: { tenantId, action: 'telephony.settings.update' }, orderBy: { seq: 'desc' } });
    expect(audit).not.toBeNull();
    // адаптер собирается по настройкам и понимает тело OnlinePBX c переопределённым id; звонок c ext 101 — от менеджера
    const settings = await getTelephonySettings(tenantId);
    const ev = buildTelephonyAdapter(settings).parseWebhook({ event: 'call_end', callid: 'opbx-1', caller_id_number: '998905559999', destination_number: '101', billsec: '30', start_stamp: '2026-09-21 11:00:00' });
    expect(ev).toMatchObject({ kind: 'CALL_FINISHED', externalId: 'opbx-1', employeeExt: '101' });
    expect(ev?.startedAt).toBe('2026-09-21T08:00:00.000Z');
    const r = await ingestCallEvent(tenantId, ev!, NOW);
    expect(r.status).toBe('NEW_LEAD');
    expect((await prisma.unitActivity.findFirstOrThrow({ where: { tenantId, externalRef: 'opbx-1' } })).actorId).toBe(cmId);
    // диагностика: непонятое тело сохраняет только ключи
    await noteTelephonyWebhook(tenantId, false, ['foo', 'bar'], NOW);
    const diag = await getTelephonySettings(tenantId);
    expect([diag.lastWebhookAt, diag.lastUnparsed?.keys]).toEqual([NOW.toISOString(), ['foo', 'bar']]);
  });
});
