import { describe, expect, it } from 'vitest';
import { OnlinePbxAdapter, buildTelephonyAdapter, parseWebhookRawBody } from './index.js';

describe('OnlinePBX adapter (P-29, ADR-032)', () => {
  const a = new OnlinePbxAdapter();

  it('CDR-поля FreeSWITCH: завершённый входящий → CALL_FINISHED, клиент = caller, ext = destination', () => {
    const ev = a.parseWebhook({ event: 'call_end', uuid: 'u-1', caller_id_number: '998905550001', destination_number: '101', start_stamp: '2026-09-19 14:03:11', billsec: '95', hangup_cause: 'NORMAL_CLEARING', download_url: 'https://pbx.example/rec/u-1.mp3' });
    expect(ev).toMatchObject({ kind: 'CALL_FINISHED', externalId: 'u-1', direction: 'IN', clientPhone: '998905550001', employeeExt: '101', durationSec: 95, recordingUrl: 'https://pbx.example/rec/u-1.mp3' });
    expect(ev?.startedAt).toBe('2026-09-19T09:03:11.000Z'); // Ташкент +05:00
  });

  it('исходящий без поля direction определяется по внутреннему номеру звонящего', () => {
    const ev = a.parseWebhook({ event: 'hangup', uuid: 'u-2', caller_id_number: '102', destination_number: '+998 90 777 00 00', billsec: 40, start_stamp: '1789809791' });
    expect(ev).toMatchObject({ direction: 'OUT', clientPhone: '+998 90 777 00 00', employeeExt: '102', durationSec: 40 });
    expect(ev?.startedAt).toBe('2026-09-19T09:23:11.000Z');
  });

  it('пропущенный: событие missed или причина NO_ANSWER при нулевой длительности', () => {
    expect(a.parseWebhook({ event: 'call_missed', uuid: 'u-3', caller_id_number: '998905550002', destination_number: '101' })).toMatchObject({ kind: 'CALL_MISSED', durationSec: 0 });
    expect(a.parseWebhook({ event: 'call_end', uuid: 'u-4', caller_id_number: '998905550002', destination_number: '101', billsec: '0', hangup_cause: 'NO_ANSWER' })).toMatchObject({ kind: 'CALL_MISSED' });
    expect(a.parseWebhook({ uuid: 'u-5', caller_id_number: '998905550002', destination_number: '101', billsec: 0, hangup_cause: 'ORIGINATOR_CANCEL' })).toMatchObject({ kind: 'CALL_MISSED' });
  });

  it('промежуточные события (ответили / звонит) и тела без id или номеров игнорируются', () => {
    expect(a.parseWebhook({ event: 'call_answered', uuid: 'u-6', caller_id_number: '998905550002', destination_number: '101' })).toBeNull();
    expect(a.parseWebhook({ event: 'ringing', uuid: 'u-7', caller_id_number: '998905550002' })).toBeNull();
    expect(a.parseWebhook({ event: 'call_end', caller_id_number: '998905550002' })).toBeNull();
    expect(a.parseWebhook({ event: 'call_end', uuid: 'u-8' })).toBeNull();
    expect(a.parseWebhook({ event: 'call_end', uuid: 'u-9', caller_id_number: '101', destination_number: '102', billsec: 5 })).toBeNull(); // внутренний звонок — не клиент
    expect(a.parseWebhook('ping')).toBeNull();
  });

  it('карта полей и зона АТС переопределяются настройками тенанта', () => {
    const custom = new OnlinePbxAdapter({ tzOffset: '+03:00', internalExtMaxLen: 3, fieldMap: { id: ['callid'], from: ['ani'], to: ['dnis'], duration: ['talk'], event: ['state'] } });
    const ev = custom.parseWebhook({ state: 'finished', callid: 'c-1', ani: '998901112233', dnis: '201', talk: '12', start: '2026-09-19 12:00:00' });
    expect(ev).toMatchObject({ kind: 'CALL_FINISHED', externalId: 'c-1', clientPhone: '998901112233', employeeExt: '201', durationSec: 12 });
    expect(ev?.startedAt).toBe('2026-09-19T09:00:00.000Z');
  });

  it('parseWebhookRawBody: form-urlencoded и JSON; фабрика выбирает адаптер по провайдеру', () => {
    expect(parseWebhookRawBody('application/x-www-form-urlencoded', 'uuid=u-1&caller_id_number=998905550001&billsec=3')).toEqual({ uuid: 'u-1', caller_id_number: '998905550001', billsec: '3' });
    expect(parseWebhookRawBody('application/json; charset=utf-8', '{"uuid":"u-2"}')).toEqual({ uuid: 'u-2' });
    expect(parseWebhookRawBody(null, 'a=1&b=2')).toEqual({ a: '1', b: '2' });
    expect(parseWebhookRawBody(null, '')).toEqual({});
    expect(() => parseWebhookRawBody('application/json', 'not json')).toThrow();
    expect(buildTelephonyAdapter({ provider: 'onlinepbx' })).toBeInstanceOf(OnlinePbxAdapter);
    expect(buildTelephonyAdapter(null)).not.toBeInstanceOf(OnlinePbxAdapter);
  });
});
