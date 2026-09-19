/**
 * Телефония (docs/21 §7, docs/07 §8): «слушать всё» — каждый звонок становится активностью CALL c длительностью
 * и ссылкой на запись у провайдера. Реального провайдера нет (Sipuni / OnlinePBX / Zadarma / оператор — по выбору владельца);
 * здесь — нормализованное событие и адаптер, принимающий наш JSON. Провайдерский адаптер добавляется без изменения домена.
 */
export type CallDirection = 'IN' | 'OUT';
export interface TelephonyEvent {
  kind: 'CALL_FINISHED' | 'CALL_MISSED';
  externalId: string;
  direction: CallDirection;
  /** Телефон клиента (внешняя сторона), любой формат. */
  clientPhone: string;
  /** Внутренний номер/линия сотрудника (для сопоставления c пользователем), если провайдер отдаёт. */
  employeeExt: string | null;
  startedAt: string; // ISO
  durationSec: number;
  recordingUrl: string | null;
}
export interface TelephonyAdapter {
  /** Разобрать тело webhook провайдера → нормализованное событие; null — не звонок (ping, неизвестный тип). */
  parseWebhook(body: unknown): TelephonyEvent | null;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : 0);

/** Наш нормализованный формат: {event, id, direction, phone, ext?, started_at, duration, recording_url?}. */
export class GenericTelephonyAdapter implements TelephonyAdapter {
  parseWebhook(body: unknown): TelephonyEvent | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    const ev = str(b.event)?.toUpperCase();
    const kind = ev === 'CALL_MISSED' || ev === 'MISSED' ? 'CALL_MISSED' : ev === 'CALL_FINISHED' || ev === 'FINISHED' || ev === 'HANGUP' ? 'CALL_FINISHED' : null;
    const id = str(b.id) ?? str(b.call_id); const phone = str(b.phone) ?? str(b.client_phone);
    if (!kind || !id || !phone) return null;
    const dir = (str(b.direction) ?? 'IN').toUpperCase();
    return { kind, externalId: id, direction: dir === 'OUT' || dir === 'OUTBOUND' ? 'OUT' : 'IN', clientPhone: phone, employeeExt: str(b.ext) ?? str(b.employee_ext), startedAt: str(b.started_at) ?? new Date().toISOString(), durationSec: kind === 'CALL_MISSED' ? 0 : num(b.duration ?? b.duration_sec), recordingUrl: str(b.recording_url) ?? str(b.record) };
  }
}

// ── P-29: выбор провайдера и разбор сырого тела webhook ──
export * from './onlinepbx.js';
import { OnlinePbxAdapter, type OnlinePbxField } from './onlinepbx.js';

export type TelephonyProvider = 'generic' | 'onlinepbx';
export const TELEPHONY_PROVIDERS: readonly TelephonyProvider[] = ['generic', 'onlinepbx'] as const;

/** Настройки телефонии тенанта (`tenant.settings.telephony`). */
export interface TelephonyConfig {
  provider: TelephonyProvider;
  tzOffset?: string;
  internalExtLen?: number;
  fieldMap?: Partial<Record<OnlinePbxField, string[]>>;
}

export function buildTelephonyAdapter(cfg: TelephonyConfig | null | undefined): TelephonyAdapter {
  if (cfg?.provider === 'onlinepbx') return new OnlinePbxAdapter({ tzOffset: cfg.tzOffset, internalExtMaxLen: cfg.internalExtLen, fieldMap: cfg.fieldMap });
  return new GenericTelephonyAdapter();
}

/** Тело webhook: JSON или application/x-www-form-urlencoded (АТС часто шлют форму). Бросает при нечитаемом теле. */
export function parseWebhookRawBody(contentType: string | null, raw: string): Record<string, unknown> {
  const ct = (contentType ?? '').toLowerCase();
  const text = raw.trim();
  if (!text) return {};
  const asForm = () => Object.fromEntries(new URLSearchParams(text));
  if (ct.includes('json')) return JSON.parse(text) as Record<string, unknown>;
  if (ct.includes('x-www-form-urlencoded')) return asForm();
  if (text.startsWith('{')) return JSON.parse(text) as Record<string, unknown>;
  if (/^[^=&\s]+=/.test(text)) return asForm();
  return JSON.parse(text) as Record<string, unknown>;
}
