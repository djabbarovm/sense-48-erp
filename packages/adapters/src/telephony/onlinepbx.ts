/**
 * P-29: адаптер OnlinePBX (выбор владельца, ADR-032). Кабинет АТС: Сервисы → Интеграция → Webhooks,
 * события «Ответили» / «Завершили» / «Пропущенный», тело — form-urlencoded или JSON.
 *
 * Официальная спецификация полей недоступна из среды разработки, поэтому адаптер терпим к вариантам имён:
 * имена полей — карта `fieldMap` (по умолчанию — CDR-имена FreeSWITCH, на котором построен OnlinePBX:
 * uuid, caller_id_number, destination_number, start_stamp, billsec, hangup_cause, download_url), которую
 * админ уточняет в настройках тенанта по диагностике первого реального webhook (ключи непонятого тела
 * сохраняются, значения — нет). Никаких жёстких предположений: любое поле переопределяемо.
 */
import type { CallDirection, TelephonyAdapter, TelephonyEvent } from './index.js';

export type OnlinePbxField = 'id' | 'event' | 'from' | 'to' | 'direction' | 'ext' | 'start' | 'duration' | 'recording' | 'hangupCause';

export const ONLINEPBX_DEFAULT_FIELDS: Record<OnlinePbxField, string[]> = {
  id: ['uuid', 'call_uuid', 'call_id', 'id'],
  event: ['event', 'type', 'status', 'call_status', 'action'],
  from: ['caller_id_number', 'caller_number', 'caller', 'from', 'src', 'from_number', 'phone'],
  to: ['destination_number', 'callee_number', 'callee', 'to', 'dst', 'to_number', 'did'],
  direction: ['direction', 'call_direction'],
  ext: ['user', 'extension', 'ext', 'accountcode', 'user_number', 'internal', 'sip_user'],
  start: ['start_stamp', 'start', 'started_at', 'start_time', 'date', 'timestamp', 'time'],
  duration: ['billsec', 'user_talk_time', 'talk_time', 'duration'],
  recording: ['download_url', 'record_url', 'recording_url', 'recording', 'download', 'record', 'link'],
  hangupCause: ['hangup_cause', 'cause', 'reason'],
};

/** Причины завершения без разговора (FreeSWITCH hangup causes). */
const MISSED_CAUSES = new Set(['NO_ANSWER', 'ORIGINATOR_CANCEL', 'USER_BUSY', 'NO_USER_RESPONSE', 'CALL_REJECTED', 'ALLOTTED_TIMEOUT', 'LOSE_RACE', 'UNALLOCATED_NUMBER']);

export interface OnlinePbxOptions {
  /** Смещение зоны АТС для меток без зоны («2026-09-19 14:03:11»); по умолчанию Ташкент +05:00. */
  tzOffset?: string | undefined;
  /** Максимальная длина внутреннего номера — так отличаем сотрудника от клиента, если направления нет. */
  internalExtMaxLen?: number | undefined;
  /** Переопределение имён полей провайдера (наше поле → список кандидатов, первый найденный побеждает). */
  fieldMap?: Partial<Record<OnlinePbxField, string[]>> | undefined;
}

const digits = (s: string) => s.replace(/\D/g, '');

export class OnlinePbxAdapter implements TelephonyAdapter {
  private readonly fields: Record<OnlinePbxField, string[]>;
  private readonly tzOffset: string;
  private readonly extLen: number;

  constructor(opts: OnlinePbxOptions = {}) {
    this.fields = { ...ONLINEPBX_DEFAULT_FIELDS };
    for (const [k, v] of Object.entries(opts.fieldMap ?? {})) if (v && v.length) this.fields[k as OnlinePbxField] = v;
    this.tzOffset = /^[+-]\d{2}:\d{2}$/.test(opts.tzOffset ?? '') ? (opts.tzOffset as string) : '+05:00';
    this.extLen = opts.internalExtMaxLen && opts.internalExtMaxLen > 0 ? opts.internalExtMaxLen : 4;
  }

  private pick(b: Record<string, unknown>, f: OnlinePbxField): string | null {
    for (const name of this.fields[f]) {
      const v = b[name];
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  }

  private isInternal(n: string | null): boolean {
    if (!n) return false;
    const d = digits(n);
    return d.length > 0 && d.length <= this.extLen;
  }

  private parseStart(raw: string | null): string {
    if (!raw) return new Date().toISOString();
    if (/^\d{13}$/.test(raw)) return new Date(Number(raw)).toISOString();
    if (/^\d{9,10}$/.test(raw)) return new Date(Number(raw) * 1000).toISOString();
    const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw) ? `${raw.replace(' ', 'T')}${raw.length === 16 ? ':00' : ''}${this.tzOffset}` : raw;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  parseWebhook(body: unknown): TelephonyEvent | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    const id = this.pick(b, 'id');
    const from = this.pick(b, 'from');
    const to = this.pick(b, 'to');
    if (!id || (!from && !to)) return null;

    const event = (this.pick(b, 'event') ?? '').toLowerCase();
    const cause = (this.pick(b, 'hangupCause') ?? '').toUpperCase();
    const durRaw = this.pick(b, 'duration');
    const duration = durRaw && /^\d+(\.\d+)?$/.test(durRaw) ? Math.round(Number(durRaw)) : null;

    // промежуточные события (ответили / звонит / набор) — не звонок, ждём завершения
    if (/answer|ring|start|dial|progress|ответил|начал/.test(event) && !/end|hangup|finish|complet|заверш/.test(event)) return null;

    let kind: TelephonyEvent['kind'] | null = null;
    if (/miss|noanswer|no_answer|not_answered|cancel|пропущ/.test(event)) kind = 'CALL_MISSED';
    else if (/hangup|end|finish|complet|заверш/.test(event)) kind = duration === 0 && MISSED_CAUSES.has(cause) ? 'CALL_MISSED' : 'CALL_FINISHED';
    else if (!event) {
      if (duration === null && !cause) return null;
      kind = (duration ?? 0) > 0 ? 'CALL_FINISHED' : MISSED_CAUSES.has(cause) || duration === 0 ? 'CALL_MISSED' : null;
    }
    if (!kind) return null;

    const dirRaw = (this.pick(b, 'direction') ?? '').toLowerCase();
    let direction: CallDirection;
    if (/^(out|outbound|outgoing|исход)/.test(dirRaw)) direction = 'OUT';
    else if (/^(in|inbound|incoming|вход)/.test(dirRaw)) direction = 'IN';
    else direction = this.isInternal(from) && !this.isInternal(to) ? 'OUT' : 'IN';

    const clientPhone = direction === 'IN' ? from ?? to : to ?? from;
    if (!clientPhone || digits(clientPhone).length < 7) return null;
    const otherSide = direction === 'IN' ? to : from;
    const employeeExt = this.pick(b, 'ext') ?? (this.isInternal(otherSide) ? otherSide : null);
    const rec = this.pick(b, 'recording');

    return {
      kind,
      externalId: id,
      direction,
      clientPhone,
      employeeExt,
      startedAt: this.parseStart(this.pick(b, 'start')),
      durationSec: kind === 'CALL_MISSED' ? 0 : duration ?? 0,
      recordingUrl: rec && /^https?:\/\//i.test(rec) ? rec : null,
    };
  }
}
