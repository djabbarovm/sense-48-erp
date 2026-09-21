/**
 * amoCRM HISTORICAL EXTRACT (READ-ONLY) — максимальный доступный исторический экстракт
 * для НЕЗАВИСИМОГО анализа (файловый пакет XLSX/CSV/JSON + README), а НЕ импорт в DMS.
 *
 * Принципы (заданы владельцем продукта):
 *  • Ничего не пишем ни в amoCRM, ни в DMS. Только GET через AmoCrmClient.
 *  • Не выдумываем и не симулируем данные. Где API не отдаёт — помечаем AVAILABLE / PARTIAL / NOT_AVAILABLE.
 *  • Сохраняем RAW + normalized + provenance (source=AMOCRM, external id, source-время, synced_at).
 *  • Модель времени: occurred_at (реальное) ≠ source_updated_at ≠ synced_at. Импорт-время не подменяет историю.
 *  • Старые стадии amoCRM остаются SOURCE STAGE; DMS-стадия — отдельная НОРМАЛИЗОВАННАЯ аналитическая.
 *  • История стадий берётся из /events (lead_status_changed). Если событий нет/усечены — PARTIAL, не симулируем.
 *
 * Возвращает структуру AmoExtract + набор «таблиц» (для CSV/XLSX). Секретов не содержит.
 */
import type { AmoCrmClient } from './client.js';
import type {
  AmoLead, AmoContact, AmoCompany, AmoTask, AmoNote, AmoEvent, AmoCustomField, AmoCustomFieldValue,
} from './types.js';
import { suggestStageMapping, type DmsDealStage } from './dryRun.js';

export type Availability = 'AVAILABLE' | 'PARTIAL' | 'NOT_AVAILABLE';
export type FieldDecision = 'MAP' | 'KEEP_RAW' | 'IGNORE' | 'NEEDS_DECISION';

/** amoCRM отдаёт время в epoch-секундах (UTC). Аккаунт — в своём часовом поясе, но API — UTC. */
export const AMO_TIME_NOTE =
  'Все *_at из amoCRM — epoch-секунды в UTC. occurred_at = реальное время события; ' +
  'source_updated_at = последнее изменение записи в amoCRM; synced_at = время выгрузки этим экстрактом.';

export interface ExtractOptions {
  /** максимум страниц на сущность (защита памяти/времени; 250 записей/страница). */
  maxPages?: number;
  /** тянуть ли примечания (calls/messages/notes) — объёмно. По умолчанию да. */
  withNotes?: boolean;
  /** тянуть ли события (история стадий/ответственных) — объёмно. По умолчанию да. */
  withEvents?: boolean;
}

export interface EntityVolume {
  entity: string;
  count: number;
  pages: number;
  truncated: boolean;
  availability: Availability;
}

/** epoch-сек → ISO 8601 UTC, либо null. */
export function isoUtc(epochSec?: number | null): string | null {
  if (epochSec == null || !Number.isFinite(epochSec) || epochSec <= 0) return null;
  return new Date(epochSec * 1000).toISOString();
}

/** amoCRM цена лида — целое (в основной валюте аккаунта, БЕЗ копеек). Отдаём как есть + пометку. */
function priceRaw(l: AmoLead): number | null {
  return typeof l.price === 'number' ? l.price : null;
}

// ── доступ к кастом-полям по коду/имени ──
function cfByCode(values: AmoCustomFieldValue[] | null | undefined, code: string): string | null {
  const c = code.toUpperCase();
  for (const f of values ?? []) {
    if ((f.field_code ?? '').toUpperCase() === c) {
      const v = (f.values ?? []).map((x) => (x.value == null ? '' : String(x.value))).filter((s) => s.trim() !== '');
      if (v.length) return v.join('; ');
    }
  }
  return null;
}
function cfByNameLike(values: AmoCustomFieldValue[] | null | undefined, needles: string[]): string | null {
  for (const f of values ?? []) {
    const name = (f.field_name ?? '').toLowerCase();
    if (needles.some((n) => name.includes(n))) {
      const v = (f.values ?? []).map((x) => (x.value == null ? '' : String(x.value))).filter((s) => s.trim() !== '');
      if (v.length) return v.join('; ');
    }
  }
  return null;
}

const PHONE_LIKE = new Set(['PHONE', 'MOBILE', 'WORK', 'WORKDD', 'FAX', 'HOME', 'OTHER']);
function phoneOf(c: AmoContact): string | null {
  for (const f of c.custom_fields_values ?? []) {
    const code = (f.field_code ?? '').toUpperCase();
    if (code === 'PHONE' || PHONE_LIKE.has(code)) {
      const v = (f.values ?? []).map((x) => (x.value == null ? '' : String(x.value))).filter((s) => s.trim() !== '');
      if (v.length) return v.join('; ');
    }
  }
  return null;
}
function emailOf(c: AmoContact): string | null {
  return cfByCode(c.custom_fields_values, 'EMAIL');
}

// ── raw pull с учётом cap/truncation ──
interface Pulled<T> { items: T[]; pages: number; truncated: boolean }
async function pull<T>(
  client: AmoCrmClient, token: string, path: string, key: string,
  cap: number, opts: { with?: string; params?: Record<string, string | number> } = {},
): Promise<Pulled<T>> {
  let pages = 0;
  const items = await client.all<T>(path, token, key, {
    maxPages: cap,
    ...(opts.with ? { with: opts.with } : {}),
    ...(opts.params ? { params: opts.params } : {}),
    onPage: (_i, p) => { pages = p; },
  });
  return { items, pages, truncated: pages >= cap };
}
function availability(p: { truncated: boolean; count: number }): Availability {
  if (p.count === 0) return 'NOT_AVAILABLE';
  return p.truncated ? 'PARTIAL' : 'AVAILABLE';
}

// ── нормализованные строки (для аналитики/экспорта) ──
export interface NormalizedDeal {
  lead_id: number;
  name: string;
  pipeline_id: number | null;
  pipeline_name: string | null;
  source_stage_id: number | null;
  source_stage_name: string | null;
  normalized_stage: DmsDealStage | null;
  normalized_verdict: string;
  price_amount: number | null;
  currency: string;
  responsible_user_id: number | null;
  responsible_user_name: string | null;
  is_won: boolean;
  is_lost: boolean;
  is_open: boolean;
  loss_reason: string | null;
  created_at: string | null;      // occurred_at (создание сделки)
  updated_at: string | null;      // source_updated_at
  closed_at: string | null;
  contact_ids: string;
  company_ids: string;
  tags: string;
  source: string | null;          // из кастом-поля «источник», если есть
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  provenance_source: 'AMOCRM';
  synced_at: string;
}

export interface StageHistoryRow {
  lead_id: number;
  from_status_id: number | null;
  from_status_name: string | null;
  to_status_id: number | null;
  to_status_name: string | null;
  changed_at: string | null;      // occurred_at (реальное время смены)
  changed_by_user_id: number | null;
  changed_by_user_name: string | null;
}

export interface FunnelRow {
  pipeline_id: number;
  pipeline_name: string;
  stage_id: number;
  stage_name: string;
  sort: number;
  normalized_stage: DmsDealStage | null;
  leads_currently_here: number;
  leads_ever_reached: number | null;      // из истории стадий; null → NOT_AVAILABLE
  ever_reached_availability: Availability;
}

export interface ActivityRow {
  user_id: number | null;
  user_name: string | null;
  tasks_total: number;
  tasks_completed: number;
  tasks_open: number;
  notes_total: number;
  calls_in: number;
  calls_out: number;
  first_activity_at: string | null;
  last_activity_at: string | null;
}

export interface SourceRow {
  source_value: string;
  origin: 'custom_field' | 'tag' | 'utm' | 'unknown';
  leads: number;
  won: number;
  lost: number;
  availability: Availability;
}

export interface CustomFieldCatalogRow {
  entity: 'leads' | 'contacts' | 'companies';
  field_id: number;
  field_name: string;
  field_type: string;
  field_code: string | null;
  enum_count: number;
  filled_count: number;
  fill_rate_pct: number;
  sample_values: string;
  decision: FieldDecision;
  decision_reason: string;
}

export interface DataQualityRow {
  metric: string;
  value: number | string;
  note: string;
}

export interface ReadinessRow {
  metric: string;
  source_data: string;
  coverage_pct: number | null;
  reliability: 'HIGH' | 'MEDIUM' | 'LOW';
  availability: Availability;
  dms_must_collect: string;
}

export interface AmoExtract {
  account: { id: number; name: string; subdomain: string } | null;
  generatedAt: string;
  timeNote: string;
  volumes: EntityVolume[];
  users: { id: number; name: string; email: string | null }[];
  pipelines: { id: number; name: string; isMain: boolean; statuses: { id: number; name: string; sort: number }[] }[];
  deals: NormalizedDeal[];
  stageHistory: StageHistoryRow[];
  funnel: FunnelRow[];
  activity: ActivityRow[];
  sources: SourceRow[];
  customFields: CustomFieldCatalogRow[];
  dataQuality: DataQualityRow[];
  readiness: ReadinessRow[];
  summary: Record<string, string | number>;
  notes: string[];
}

const AMO_WON = 142; // системный статус «успешно реализовано»
const AMO_LOST = 143; // системный статус «закрыто и не реализовано»

function nameById<T extends { id: number; name: string }>(list: T[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const x of list) m.set(x.id, x.name);
  return m;
}

/** Основной экстракт. token — долгосрочный (или access) Bearer. */
export async function runAmoExtract(client: AmoCrmClient, token: string, options: ExtractOptions = {}): Promise<AmoExtract> {
  const cap = options.maxPages ?? 400; // 400×250 = до 100k записей/сущность
  const withNotes = options.withNotes ?? true;
  const withEvents = options.withEvents ?? true;
  const notes: string[] = [];
  const syncedAt = new Date().toISOString();

  // account
  let account: AmoExtract['account'] = null;
  try {
    const a = await client.account(token);
    if (a) account = { id: a.id, name: a.name, subdomain: a.subdomain };
  } catch (e) {
    notes.push(`account недоступен: ${(e as Error).message}`);
  }

  // справочники
  const usersRaw = await pull<{ id: number; name: string; email?: string }>(client, token, '/users', 'users', cap);
  const users = usersRaw.items.map((u) => ({ id: u.id, name: u.name, email: u.email ?? null }));
  const userName = new Map(users.map((u) => [u.id, u.name] as const));

  const pipesRaw = await pull<{ id: number; name: string; is_main?: boolean; _embedded?: { statuses?: { id: number; name: string; sort: number }[] } }>(
    client, token, '/leads/pipelines', 'pipelines', cap,
  );
  const pipelines = pipesRaw.items.map((p) => ({
    id: p.id, name: p.name, isMain: !!p.is_main,
    statuses: (p._embedded?.statuses ?? []).map((s) => ({ id: s.id, name: s.name, sort: s.sort })),
  }));
  const pipeName = nameById(pipelines);
  const statusName = new Map<number, string>();
  const statusPipeline = new Map<number, number>();
  for (const p of pipelines) for (const s of p.statuses) { statusName.set(s.id, s.name); statusPipeline.set(s.id, p.id); }

  // сущности
  const leadsRaw = await pull<AmoLead>(client, token, '/leads', 'leads', cap, { with: 'contacts,loss_reason' });
  const contactsRaw = await pull<AmoContact>(client, token, '/contacts', 'contacts', cap, { with: 'companies' });
  const companiesRaw = await pull<AmoCompany>(client, token, '/companies', 'companies', cap);
  const tasksRaw = await pull<AmoTask>(client, token, '/tasks', 'tasks', cap);

  let notesLeads: Pulled<AmoNote> = { items: [], pages: 0, truncated: false };
  let notesContacts: Pulled<AmoNote> = { items: [], pages: 0, truncated: false };
  if (withNotes) {
    notesLeads = await pull<AmoNote>(client, token, '/leads/notes', 'notes', cap);
    notesContacts = await pull<AmoNote>(client, token, '/contacts/notes', 'notes', cap);
  } else {
    notes.push('Примечания/звонки не выгружались (withNotes=false).');
  }

  let eventsRaw: Pulled<AmoEvent> = { items: [], pages: 0, truncated: false };
  if (withEvents) {
    eventsRaw = await pull<AmoEvent>(client, token, '/events', 'events', cap);
  } else {
    notes.push('События (история стадий) не выгружались (withEvents=false).');
  }

  // кастом-поля (каталог)
  const cfRaw: { entity: 'leads' | 'contacts' | 'companies'; f: AmoCustomField }[] = [];
  for (const entity of ['leads', 'contacts', 'companies'] as const) {
    const list = await pull<AmoCustomField>(client, token, `/${entity}/custom_fields`, 'custom_fields', cap);
    for (const f of list.items) cfRaw.push({ entity, f });
  }

  // ── нормализация сделок ──
  const deals: NormalizedDeal[] = leadsRaw.items.map((l) => {
    const sid = l.status_id ?? null;
    const sname = sid != null ? (statusName.get(sid) ?? null) : null;
    const mapping = sname ? suggestStageMapping(sname) : { stage: null as DmsDealStage | null, verdict: 'NO_EQUIVALENT' };
    const isWon = sid === AMO_WON || mapping.stage === 'WON';
    const isLost = sid === AMO_LOST || mapping.stage === 'LOST';
    const cf = l.custom_fields_values;
    return {
      lead_id: l.id,
      name: l.name ?? '',
      pipeline_id: l.pipeline_id ?? null,
      pipeline_name: l.pipeline_id != null ? (pipeName.get(l.pipeline_id) ?? null) : null,
      source_stage_id: sid,
      source_stage_name: sname,
      normalized_stage: mapping.stage,
      normalized_verdict: mapping.verdict,
      price_amount: priceRaw(l),
      currency: 'UZS',
      responsible_user_id: l.responsible_user_id ?? null,
      responsible_user_name: l.responsible_user_id != null ? (userName.get(l.responsible_user_id) ?? null) : null,
      is_won: isWon,
      is_lost: isLost,
      is_open: !isWon && !isLost,
      loss_reason: l._embedded?.loss_reason?.map((r) => r.name).join('; ') || null,
      created_at: isoUtc(l.created_at),
      updated_at: isoUtc(l.updated_at),
      closed_at: isoUtc(l.closed_at),
      contact_ids: (l._embedded?.contacts ?? []).map((c) => c.id).join(','),
      company_ids: (l._embedded?.companies ?? []).map((c) => c.id).join(','),
      tags: (l._embedded?.tags ?? []).map((t) => t.name).join('; '),
      source: cfByNameLike(cf, ['источник', 'source', 'канал']),
      utm_source: cfByCode(cf, 'UTM_SOURCE') ?? cfByNameLike(cf, ['utm_source']),
      utm_medium: cfByCode(cf, 'UTM_MEDIUM') ?? cfByNameLike(cf, ['utm_medium']),
      utm_campaign: cfByCode(cf, 'UTM_CAMPAIGN') ?? cfByNameLike(cf, ['utm_campaign']),
      provenance_source: 'AMOCRM',
      synced_at: syncedAt,
    };
  });

  // ── история стадий из событий ──
  const stageEvents = eventsRaw.items.filter((e) => (e.type ?? '') === 'lead_status_changed' && (e.entity_type ?? 'lead') === 'lead');
  const statusFromEventValue = (v: unknown): number | null => {
    // amoCRM value_before/value_after: [{ lead_status: { id, pipeline_id } }] или { id }
    if (Array.isArray(v) && v.length) {
      const first = v[0] as Record<string, unknown>;
      const ls = (first?.['lead_status'] ?? first) as Record<string, unknown> | undefined;
      const id = ls?.['id'];
      return typeof id === 'number' ? id : null;
    }
    if (v && typeof v === 'object') {
      const id = (v as Record<string, unknown>)['id'];
      return typeof id === 'number' ? id : null;
    }
    return null;
  };
  const stageHistory: StageHistoryRow[] = stageEvents.map((e) => {
    const fromId = statusFromEventValue(e.value_before);
    const toId = statusFromEventValue(e.value_after);
    return {
      lead_id: e.entity_id ?? 0,
      from_status_id: fromId,
      from_status_name: fromId != null ? (statusName.get(fromId) ?? null) : null,
      to_status_id: toId,
      to_status_name: toId != null ? (statusName.get(toId) ?? null) : null,
      changed_at: isoUtc(e.created_at),
      changed_by_user_id: e.created_by ?? null,
      changed_by_user_name: e.created_by != null ? (userName.get(e.created_by) ?? null) : null,
    };
  });
  // Всегда как минимум PARTIAL при наличии событий: amoCRM хранит события ограниченный период —
  // полную историю за всё время гарантировать нельзя, поэтому AVAILABLE тут не выставляем.
  const stageHistoryAvail: Availability = (!withEvents || stageHistory.length === 0) ? 'NOT_AVAILABLE' : 'PARTIAL';
  if (withEvents && stageHistory.length > 0) {
    notes.push('История стадий восстановлена из /events (lead_status_changed). amoCRM хранит события ограниченный срок — ранние переходы могут отсутствовать; это PARTIAL, не симулируем.');
  }

  // ── воронка ──
  const currentByStage = new Map<number, number>();
  for (const d of deals) if (d.source_stage_id != null) currentByStage.set(d.source_stage_id, (currentByStage.get(d.source_stage_id) ?? 0) + 1);
  const everReached = new Map<number, Set<number>>(); // stage_id → set(lead_id)
  for (const h of stageHistory) if (h.to_status_id != null) {
    if (!everReached.has(h.to_status_id)) everReached.set(h.to_status_id, new Set());
    everReached.get(h.to_status_id)!.add(h.lead_id);
  }
  const funnel: FunnelRow[] = [];
  for (const p of pipelines) {
    for (const s of [...p.statuses].sort((a, b) => a.sort - b.sort)) {
      const ever = everReached.get(s.id);
      funnel.push({
        pipeline_id: p.id,
        pipeline_name: p.name,
        stage_id: s.id,
        stage_name: s.name,
        sort: s.sort,
        normalized_stage: suggestStageMapping(s.name).stage,
        leads_currently_here: currentByStage.get(s.id) ?? 0,
        leads_ever_reached: stageHistoryAvail === 'NOT_AVAILABLE' ? null : (ever ? ever.size : 0),
        ever_reached_availability: stageHistoryAvail,
      });
    }
  }

  // ── активность ──
  const act = new Map<number, ActivityRow>();
  const ensure = (uid: number | null): ActivityRow => {
    const key = uid ?? -1;
    let r = act.get(key);
    if (!r) {
      r = {
        user_id: uid, user_name: uid != null ? (userName.get(uid) ?? null) : null,
        tasks_total: 0, tasks_completed: 0, tasks_open: 0, notes_total: 0, calls_in: 0, calls_out: 0,
        first_activity_at: null, last_activity_at: null,
      };
      act.set(key, r);
    }
    return r;
  };
  const touch = (r: ActivityRow, epochSec?: number | null) => {
    const iso = isoUtc(epochSec);
    if (!iso) return;
    if (!r.first_activity_at || iso < r.first_activity_at) r.first_activity_at = iso;
    if (!r.last_activity_at || iso > r.last_activity_at) r.last_activity_at = iso;
  };
  for (const t of tasksRaw.items) {
    const r = ensure(t.responsible_user_id ?? null);
    r.tasks_total++;
    if (t.is_completed) r.tasks_completed++; else r.tasks_open++;
    touch(r, t.created_at);
  }
  const allNotes = [...notesLeads.items, ...notesContacts.items];
  for (const n of allNotes) {
    const r = ensure(n.created_by ?? null);
    r.notes_total++;
    const nt = (n.note_type ?? '').toLowerCase();
    if (nt.includes('call_in') || nt === 'call_in') r.calls_in++;
    if (nt.includes('call_out') || nt === 'call_out') r.calls_out++;
    touch(r, n.created_at);
  }
  const activity = [...act.values()].sort((a, b) => (b.tasks_total + b.notes_total) - (a.tasks_total + a.notes_total));

  // ── источники ──
  const srcMap = new Map<string, { origin: SourceRow['origin']; leads: number; won: number; lost: number }>();
  let sourceFieldPresent = false;
  for (const d of deals) {
    let val = d.source; let origin: SourceRow['origin'] = 'custom_field';
    if (val) sourceFieldPresent = true;
    if (!val && d.utm_source) { val = d.utm_source; origin = 'utm'; }
    if (!val && d.tags) { val = d.tags.split(';')[0]!.trim(); origin = 'tag'; }
    const key = val && val.trim() !== '' ? val.trim() : '(не указан)';
    const o = val && val.trim() !== '' ? origin : 'unknown';
    let e = srcMap.get(key);
    if (!e) { e = { origin: o, leads: 0, won: 0, lost: 0 }; srcMap.set(key, e); }
    e.leads++; if (d.is_won) e.won++; if (d.is_lost) e.lost++;
  }
  const sourceAvail: Availability = sourceFieldPresent ? 'AVAILABLE' : (srcMap.size > 1 ? 'PARTIAL' : 'NOT_AVAILABLE');
  const sources: SourceRow[] = [...srcMap.entries()]
    .map(([source_value, v]) => ({ source_value, origin: v.origin, leads: v.leads, won: v.won, lost: v.lost, availability: sourceAvail }))
    .sort((a, b) => b.leads - a.leads);

  // ── каталог кастом-полей: fill-rate + sample + decision ──
  const cfFilled = new Map<string, { count: number; samples: Set<string> }>(); // key = entity:field_id
  const bump = (entity: string, values: AmoCustomFieldValue[] | null | undefined) => {
    for (const f of values ?? []) {
      const vals = (f.values ?? []).map((x) => (x.value == null ? '' : String(x.value))).filter((s) => s.trim() !== '');
      if (!vals.length) continue;
      const key = `${entity}:${f.field_id}`;
      let e = cfFilled.get(key);
      if (!e) { e = { count: 0, samples: new Set() }; cfFilled.set(key, e); }
      e.count++;
      if (e.samples.size < 3) for (const v of vals) { if (e.samples.size < 3) e.samples.add(v.slice(0, 40)); }
    }
  };
  for (const l of leadsRaw.items) bump('leads', l.custom_fields_values);
  for (const c of contactsRaw.items) bump('contacts', c.custom_fields_values);
  for (const c of companiesRaw.items) bump('companies', c.custom_fields_values);
  const entityCount: Record<string, number> = { leads: leadsRaw.items.length, contacts: contactsRaw.items.length, companies: companiesRaw.items.length };
  const decide = (name: string, type: string, filled: number): { decision: FieldDecision; reason: string } => {
    const n = name.toLowerCase();
    if (filled === 0) return { decision: 'IGNORE', reason: 'поле не заполнено ни в одной записи' };
    if (/тел|phone|email|почт|utm|источник|source|канал|бюджет|budget|сумм|price|цена|адрес|address/.test(n)) return { decision: 'MAP', reason: 'узнаваемый бизнес-атрибут — кандидат на маппинг в DMS' };
    if (type === 'select' || type === 'multiselect' || type === 'radiobutton') return { decision: 'KEEP_RAW', reason: 'enum-поле — сохранить справочник значений как есть' };
    return { decision: 'NEEDS_DECISION', reason: 'назначение неочевидно — решение владельца до маппинга/удаления' };
  };
  const customFields: CustomFieldCatalogRow[] = cfRaw.map(({ entity, f }) => {
    const stat = cfFilled.get(`${entity}:${f.id}`);
    const total = entityCount[entity] ?? 0;
    const filled = stat?.count ?? 0;
    const d = decide(f.name, f.type, filled);
    return {
      entity, field_id: f.id, field_name: f.name, field_type: f.type, field_code: f.code ?? null,
      enum_count: (f.enums ?? []).length,
      filled_count: filled,
      fill_rate_pct: total > 0 ? Math.round((filled / total) * 1000) / 10 : 0,
      sample_values: [...(stat?.samples ?? [])].join(' | '),
      decision: d.decision, decision_reason: d.reason,
    };
  });

  // ── качество данных ──
  const leadsWithoutResp = deals.filter((d) => d.responsible_user_id == null).length;
  const leadsWithoutPipe = deals.filter((d) => d.pipeline_id == null).length;
  const leadsWithoutContacts = deals.filter((d) => d.contact_ids === '').length;
  const leadsWithoutPrice = deals.filter((d) => d.price_amount == null || d.price_amount === 0).length;
  const leadsWithoutCreated = deals.filter((d) => d.created_at == null).length;
  const contactsWithoutPhoneEmail = contactsRaw.items.filter((c) => !phoneOf(c) && !emailOf(c)).length;
  const contactsWithoutName = contactsRaw.items.filter((c) => !c.name || c.name.trim() === '').length;
  const lostWithoutReason = deals.filter((d) => d.is_lost && !d.loss_reason).length;
  const dataQuality: DataQualityRow[] = [
    { metric: 'leads_total', value: deals.length, note: leadsRaw.truncated ? `частично: достигнут лимит ${cap} стр.` : 'полностью' },
    { metric: 'leads_without_responsible', value: leadsWithoutResp, note: 'нельзя атрибутировать сотруднику' },
    { metric: 'leads_without_pipeline', value: leadsWithoutPipe, note: 'не попадают в воронку' },
    { metric: 'leads_without_contacts', value: leadsWithoutContacts, note: 'нет связи с человеком/компанией' },
    { metric: 'leads_without_price', value: leadsWithoutPrice, note: 'сумма 0/пусто — сумма сделки ненадёжна' },
    { metric: 'leads_without_created_at', value: leadsWithoutCreated, note: 'нет времени создания' },
    { metric: 'lost_without_reason', value: lostWithoutReason, note: 'причина отказа не заполнена' },
    { metric: 'contacts_total', value: contactsRaw.items.length, note: contactsRaw.truncated ? `частично (лимит ${cap} стр.)` : 'полностью' },
    { metric: 'contacts_without_name', value: contactsWithoutName, note: '' },
    { metric: 'contacts_without_phone_or_email', value: contactsWithoutPhoneEmail, note: 'нельзя связаться/дедуплицировать' },
    { metric: 'companies_total', value: companiesRaw.items.length, note: companiesRaw.truncated ? `частично (лимит ${cap} стр.)` : 'полностью' },
    { metric: 'stage_history_events', value: stageHistory.length, note: stageHistoryAvail },
  ];

  // ── объёмы ──
  const vol = (entity: string, p: Pulled<unknown>): EntityVolume => ({ entity, count: p.items.length, pages: p.pages, truncated: p.truncated, availability: availability({ truncated: p.truncated, count: p.items.length }) });
  const volumes: EntityVolume[] = [
    vol('users', usersRaw), vol('pipelines', pipesRaw), vol('leads', leadsRaw), vol('contacts', contactsRaw),
    vol('companies', companiesRaw), vol('tasks', tasksRaw),
    vol('notes_leads', notesLeads), vol('notes_contacts', notesContacts), vol('events', eventsRaw),
  ];

  // ── матрица готовности аналитики ──
  const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
  const dealsN = deals.length;
  const readiness: ReadinessRow[] = [
    { metric: 'Кол-во сделок / период', source_data: 'leads.created_at', coverage_pct: pct(dealsN - leadsWithoutCreated, dealsN), reliability: 'HIGH', availability: leadsRaw.truncated ? 'PARTIAL' : 'AVAILABLE', dms_must_collect: 'created_at фиксируется системой при создании — уже надёжно' },
    { metric: 'Конверсия по воронке (стадия→стадия)', source_data: 'events.lead_status_changed', coverage_pct: pct(stageHistory.length, dealsN), reliability: 'MEDIUM', availability: stageHistoryAvail, dms_must_collect: 'DMS обязан писать КАЖДЫЙ переход стадии как событие (occurred_at) с сегодняшнего дня' },
    { metric: 'Время в стадии / скорость сделки', source_data: 'events (entered/exited)', coverage_pct: pct(stageHistory.length, dealsN), reliability: stageHistory.length > 0 && !eventsRaw.truncated ? 'MEDIUM' : 'LOW', availability: stageHistoryAvail, dms_must_collect: 'entered_at/exited_at на каждый переход — иначе time-in-stage посчитать нельзя' },
    { metric: 'Сумма/стоимость сделки', source_data: 'leads.price', coverage_pct: pct(dealsN - leadsWithoutPrice, dealsN), reliability: leadsWithoutPrice > dealsN / 2 ? 'LOW' : 'MEDIUM', availability: dealsN === 0 ? 'NOT_AVAILABLE' : (leadsWithoutPrice > 0 ? 'PARTIAL' : 'AVAILABLE'), dms_must_collect: 'сумма — из подтверждённого финфакта DMS/Finance, не из CRM (CRM = намерение)' },
    { metric: 'Атрибуция по сотруднику', source_data: 'leads.responsible_user_id', coverage_pct: pct(dealsN - leadsWithoutResp, dealsN), reliability: 'MEDIUM', availability: dealsN === 0 ? 'NOT_AVAILABLE' : (leadsWithoutResp > 0 ? 'PARTIAL' : 'AVAILABLE'), dms_must_collect: 'ответственный на момент КАЖДОГО этапа (история смены владельца), не только текущий' },
    { metric: 'Источник/канал лида', source_data: 'custom field / utm / tag', coverage_pct: pct(deals.filter((d) => d.source || d.utm_source).length, dealsN), reliability: sourceFieldPresent ? 'MEDIUM' : 'LOW', availability: sourceAvail, dms_must_collect: 'структурированный справочник источников + UTM на входящем лиде' },
    { metric: 'Причины отказа', source_data: 'leads.loss_reason', coverage_pct: pct(deals.filter((d) => d.is_lost && d.loss_reason).length, Math.max(1, deals.filter((d) => d.is_lost).length)), reliability: 'MEDIUM', availability: deals.some((d) => d.is_lost && d.loss_reason) ? 'PARTIAL' : 'NOT_AVAILABLE', dms_must_collect: 'обязательная причина отказа из справочника при переходе в LOST' },
    { metric: 'Активность (звонки/задачи)', source_data: 'tasks + notes(call_in/out)', coverage_pct: pct(allNotes.length, Math.max(1, allNotes.length)), reliability: 'LOW', availability: (withNotes && allNotes.length > 0) ? 'PARTIAL' : 'NOT_AVAILABLE', dms_must_collect: 'активность — вторичный индикатор; связывать с исходом, а не рейтинговать по кол-ву звонков' },
    { metric: 'Привязка к объекту (Unit)', source_data: 'custom field (объект/квартира)', coverage_pct: null, reliability: 'LOW', availability: 'NOT_AVAILABLE', dms_must_collect: 'DMS должен вести deal.unit_id; авто-матчинг по имени НЕ делаем — нужен маппинг-репорт' },
  ];

  // ── сводка ──
  const won = deals.filter((d) => d.is_won).length;
  const lost = deals.filter((d) => d.is_lost).length;
  const open = deals.filter((d) => d.is_open).length;
  const summary: Record<string, string | number> = {
    account: account ? `${account.name} (${account.subdomain})` : '—',
    generated_at: syncedAt,
    users: users.length,
    pipelines: pipelines.length,
    deals_total: deals.length,
    deals_won: won,
    deals_lost: lost,
    deals_open: open,
    win_rate_pct: won + lost > 0 ? Math.round((won / (won + lost)) * 1000) / 10 : 0,
    contacts_total: contactsRaw.items.length,
    companies_total: companiesRaw.items.length,
    tasks_total: tasksRaw.items.length,
    notes_total: allNotes.length,
    stage_history_events: stageHistory.length,
    custom_fields_total: customFields.length,
    any_truncated: volumes.some((v) => v.truncated) ? 'ДА — часть данных усечена лимитом страниц, см. volumes' : 'нет',
  };

  return {
    account, generatedAt: syncedAt, timeNote: AMO_TIME_NOTE, volumes, users, pipelines,
    deals, stageHistory, funnel, activity, sources, customFields, dataQuality, readiness, summary, notes,
  };
}

// ── таблицы для CSV/XLSX (по одной на «лист») ──
export interface AmoTable {
  sheet: string;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
}

/** Плоские таблицы из экстракта — источник для CSV-файлов и листов XLSX. */
export function buildAmoTables(x: AmoExtract): AmoTable[] {
  const summaryRows = Object.entries(x.summary).map(([metric, value]) => ({ metric, value }));
  const volRows = x.volumes.map((v) => ({ entity: v.entity, count: v.count, pages: v.pages, truncated: v.truncated ? 'да' : 'нет', availability: v.availability }));
  const userRows = x.users.map((u) => ({ id: u.id, name: u.name, email: u.email }));
  const stageRows = x.pipelines.flatMap((p) => p.statuses.map((s) => ({ pipeline_id: p.id, pipeline_name: p.name, is_main: p.isMain ? 'да' : 'нет', stage_id: s.id, stage_name: s.name, sort: s.sort })));
  const pipeRows = x.pipelines.map((p) => ({ id: p.id, name: p.name, is_main: p.isMain ? 'да' : 'нет', stages: p.statuses.length }));

  const asRows = <T extends object>(arr: T[]) => arr.map((r) => r as Record<string, string | number | null>);
  const cols = (arr: Array<Record<string, unknown>>): string[] => (arr.length ? Object.keys(arr[0]!) : []);

  const tables: AmoTable[] = [
    { sheet: 'Summary', columns: ['metric', 'value'], rows: summaryRows },
    { sheet: 'Volumes', columns: ['entity', 'count', 'pages', 'truncated', 'availability'], rows: volRows },
    { sheet: 'Users', columns: ['id', 'name', 'email'], rows: userRows },
    { sheet: 'Pipelines', columns: ['id', 'name', 'is_main', 'stages'], rows: pipeRows },
    { sheet: 'Stages', columns: ['pipeline_id', 'pipeline_name', 'is_main', 'stage_id', 'stage_name', 'sort'], rows: stageRows },
    { sheet: 'Deals', columns: cols(asRows(x.deals)), rows: asRows(x.deals) },
    { sheet: 'Funnel', columns: cols(asRows(x.funnel)), rows: asRows(x.funnel) },
    { sheet: 'StageHistory', columns: cols(asRows(x.stageHistory)), rows: asRows(x.stageHistory) },
    { sheet: 'Activity', columns: cols(asRows(x.activity)), rows: asRows(x.activity) },
    { sheet: 'Sources', columns: cols(asRows(x.sources)), rows: asRows(x.sources) },
    { sheet: 'CustomFields', columns: cols(asRows(x.customFields)), rows: asRows(x.customFields) },
    { sheet: 'DataQuality', columns: cols(asRows(x.dataQuality)), rows: asRows(x.dataQuality) },
    { sheet: 'AnalyticsReadiness', columns: cols(asRows(x.readiness)), rows: asRows(x.readiness) },
  ];
  return tables;
}
