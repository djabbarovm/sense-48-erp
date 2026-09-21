/**
 * amoCRM DRY-RUN (READ-ONLY): каталог воронок/статусов, кастом-полей, пользователей,
 * объёмы сущностей, отчёт качества данных и предложение маппинга воронка→DMS-стадии.
 * НИЧЕГО не пишет — ни в amoCRM, ни в DMS. Только читает через AmoCrmClient.
 *
 * Считаем объёмы стримингом (onPage), с ограничением maxPages — если упёрлись в лимит,
 * помечаем truncated=true и отдаём «≥ N». Так dry-run не тянет весь аккаунт в память.
 */
import type { AmoCrmClient } from './client.js';
import type { AmoLead, AmoContact, AmoCompany } from './types.js';

// Стадии сделки DMS Tower (packages/core deal state machine) — цель маппинга.
export type DmsDealStage =
  | 'NEW' | 'QUALIFIED' | 'PROPERTY_SELECTED' | 'VIEWING' | 'OFFER'
  | 'NEGOTIATION' | 'LOI' | 'CONTRACT' | 'MOVE_IN' | 'WON' | 'LOST';

export type MappingVerdict = 'MATCH' | 'MAPPABLE' | 'AMBIGUOUS' | 'NO_EQUIVALENT';

export interface StageMapping {
  amoStatusId: number;
  amoStatusName: string;
  suggestedDmsStage: DmsDealStage | null;
  verdict: MappingVerdict;
}

export interface PipelineReport {
  id: number;
  name: string;
  isMain: boolean;
  statuses: { id: number; name: string; sort: number }[];
  leadCount: number;
  leadCountTruncated: boolean;
  stageMapping: StageMapping[];
}

export interface CustomFieldReport {
  entity: 'leads' | 'contacts' | 'companies';
  id: number;
  name: string;
  type: string;
  code: string | null;
  enumCount: number;
}

export interface UserReport { id: number; name: string; email: string | null }

export interface DataQuality {
  leadsTotal: number;
  leadsTruncated: boolean;
  leadsWithoutResponsible: number;
  leadsWithoutPipeline: number;
  leadsWithoutContacts: number;
  contactsTotal: number;
  contactsTruncated: boolean;
  contactsWithoutName: number;
  contactsWithoutPhoneOrEmail: number;
  contactsWithoutResponsible: number;
  companiesTotal: number;
  companiesTruncated: boolean;
}

export interface AmoDryRunReport {
  account: { id: number; name: string; subdomain: string } | null;
  users: UserReport[];
  pipelines: PipelineReport[];
  customFields: CustomFieldReport[];
  dataQuality: DataQuality;
  generatedAt: string;
  notes: string[];
}

const PHONE_CODES = new Set(['PHONE', 'MOBILE', 'WORK', 'WORKDD', 'FAX', 'HOME', 'OTHER']);

/** Есть ли у контакта телефон или email (по стандартным кастом-полям amoCRM). */
function hasPhoneOrEmail(c: AmoContact): boolean {
  const fields = c.custom_fields_values ?? [];
  return fields.some((f) => {
    const code = (f.field_code ?? '').toUpperCase();
    if (code === 'PHONE' || code === 'EMAIL' || PHONE_CODES.has(code)) {
      return (f.values ?? []).some((v) => v.value != null && String(v.value).trim() !== '');
    }
    return false;
  });
}

/** Нормализация имени статуса amoCRM для эвристики маппинга. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[ё]/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
}

/** Ключевые слова стадий DMS (ru/en) для сопоставления статуса воронки. */
const STAGE_KEYWORDS: { stage: DmsDealStage; kw: string[] }[] = [
  { stage: 'NEW', kw: ['new', 'нов', 'заявк', 'первичн', 'входящ', 'неразобранное', 'unsorted'] },
  { stage: 'QUALIFIED', kw: ['квалиф', 'qualif', 'обработ', 'взят в работу', 'в работе'] },
  { stage: 'PROPERTY_SELECTED', kw: ['подбор', 'выбор объект', 'select', 'предложен объект'] },
  { stage: 'VIEWING', kw: ['показ', 'просмотр', 'viewing', 'встреч', 'meeting'] },
  { stage: 'OFFER', kw: ['оффер', 'offer', 'коммерческ', 'кп', 'предложен'] },
  { stage: 'NEGOTIATION', kw: ['переговор', 'negotiat', 'торг', 'обсужден'] },
  { stage: 'LOI', kw: ['loi', 'бронь', 'резерв', 'предварит', 'аванс', 'предоплат'] },
  { stage: 'CONTRACT', kw: ['договор', 'contract', 'подписан', 'сделк'] },
  { stage: 'MOVE_IN', kw: ['заселен', 'move in', 'передача ключ', 'въезд'] },
  { stage: 'WON', kw: ['успешно реализовано', 'won', 'успешн', 'оплачен', 'закрыт успех', 'выигран'] },
  { stage: 'LOST', kw: ['закрыто и не реализовано', 'lost', 'отказ', 'проигран', 'не реализов', 'потерян'] },
];

/** Эвристика: статус воронки amoCRM → предложенная стадия DMS + вердикт. */
export function suggestStageMapping(statusName: string): { stage: DmsDealStage | null; verdict: MappingVerdict } {
  const n = norm(statusName);
  const hits: DmsDealStage[] = [];
  for (const { stage, kw } of STAGE_KEYWORDS) {
    if (kw.some((k) => n.includes(norm(k)))) hits.push(stage);
  }
  if (hits.length === 0) return { stage: null, verdict: 'NO_EQUIVALENT' };
  if (hits.length === 1) {
    // системные точные названия amoCRM → MATCH, иначе MAPPABLE
    const exact = n === 'успешно реализовано' || n === 'закрыто и не реализовано';
    return { stage: hits[0]!, verdict: exact ? 'MATCH' : 'MAPPABLE' };
  }
  return { stage: hits[0]!, verdict: 'AMBIGUOUS' };
}

const MAX_PAGES = 200; // 200 × 250 = до 50k записей на сущность в dry-run

/** Запустить dry-run. token — долгосрочный (или access) Bearer. */
export async function runAmoDryRun(client: AmoCrmClient, token: string): Promise<AmoDryRunReport> {
  const notes: string[] = [];

  // account — health check
  let account: AmoDryRunReport['account'] = null;
  try {
    const a = await client.account(token);
    if (a) account = { id: a.id, name: a.name, subdomain: a.subdomain };
  } catch (e) {
    notes.push(`account недоступен: ${(e as Error).message}`);
  }

  // пользователи
  const usersRaw = await client.listUsers(token);
  const users: UserReport[] = usersRaw.map((u) => ({ id: u.id, name: u.name, email: u.email ?? null }));

  // воронки + статусы
  const pipesRaw = await client.listPipelines(token);

  // кастом-поля
  const customFields: CustomFieldReport[] = [];
  for (const entity of ['leads', 'contacts', 'companies'] as const) {
    const cf = await client.listCustomFields(token, entity);
    for (const f of cf) {
      customFields.push({ entity, id: f.id, name: f.name, type: f.type, code: f.code ?? null, enumCount: (f.enums ?? []).length });
    }
  }

  // объёмы + качество данных (стримингом)
  const leadCountByPipeline = new Map<number, number>();
  let leadsTotal = 0, leadsWithoutResponsible = 0, leadsWithoutPipeline = 0, leadsWithoutContacts = 0;
  let leadPages = 0;
  await client.listLeads(token, (items, page) => {
    leadPages = page;
    for (const l of items as AmoLead[]) {
      leadsTotal++;
      if (!l.responsible_user_id) leadsWithoutResponsible++;
      if (!l.pipeline_id) leadsWithoutPipeline++;
      else leadCountByPipeline.set(l.pipeline_id, (leadCountByPipeline.get(l.pipeline_id) ?? 0) + 1);
      if (!(l._embedded?.contacts?.length)) leadsWithoutContacts++;
    }
  });
  const leadsTruncated = leadPages >= MAX_PAGES;

  let contactsTotal = 0, contactsWithoutName = 0, contactsWithoutPhoneOrEmail = 0, contactsWithoutResponsible = 0;
  let contactPages = 0;
  await client.listContacts(token, (items, page) => {
    contactPages = page;
    for (const c of items as AmoContact[]) {
      contactsTotal++;
      if (!c.name || c.name.trim() === '') contactsWithoutName++;
      if (!hasPhoneOrEmail(c)) contactsWithoutPhoneOrEmail++;
      if (!c.responsible_user_id) contactsWithoutResponsible++;
    }
  });
  const contactsTruncated = contactPages >= MAX_PAGES;

  let companiesTotal = 0, companyPages = 0;
  await client.listCompanies(token, (items, page) => {
    companyPages = page;
    companiesTotal += (items as AmoCompany[]).length;
  });
  const companiesTruncated = companyPages >= MAX_PAGES;

  const pipelines: PipelineReport[] = pipesRaw.map((p) => {
    const statuses = (p._embedded?.statuses ?? []).map((s) => ({ id: s.id, name: s.name, sort: s.sort }));
    return {
      id: p.id,
      name: p.name,
      isMain: !!p.is_main,
      statuses,
      leadCount: leadCountByPipeline.get(p.id) ?? 0,
      leadCountTruncated: leadsTruncated,
      stageMapping: statuses.map((s) => {
        const { stage, verdict } = suggestStageMapping(s.name);
        return { amoStatusId: s.id, amoStatusName: s.name, suggestedDmsStage: stage, verdict };
      }),
    };
  });

  if (leadsTruncated) notes.push(`Лидов ≥ ${leadsTotal} (достигнут лимит ${MAX_PAGES} страниц — счётчик частичный).`);
  if (contactsTruncated) notes.push(`Контактов ≥ ${contactsTotal} (лимит страниц).`);
  if (companiesTruncated) notes.push(`Компаний ≥ ${companiesTotal} (лимит страниц).`);

  return {
    account,
    users,
    pipelines,
    customFields,
    dataQuality: {
      leadsTotal, leadsTruncated, leadsWithoutResponsible, leadsWithoutPipeline, leadsWithoutContacts,
      contactsTotal, contactsTruncated, contactsWithoutName, contactsWithoutPhoneOrEmail, contactsWithoutResponsible,
      companiesTotal, companiesTruncated,
    },
    generatedAt: new Date().toISOString(),
    notes,
  };
}

/** Человекочитаемый отчёт (для консоли / админ-экрана). Секретов не содержит. */
export function formatAmoDryRun(r: AmoDryRunReport): string {
  const L: string[] = [];
  L.push('═══ amoCRM DRY-RUN (READ-ONLY) ═══');
  L.push(`Время: ${r.generatedAt}`);
  L.push(r.account ? `Аккаунт: ${r.account.name} (id=${r.account.id}, subdomain=${r.account.subdomain})` : 'Аккаунт: —');
  L.push('');
  L.push(`Пользователи amoCRM (${r.users.length}) — для маппинга на сотрудников DMS:`);
  for (const u of r.users) L.push(`  • ${u.id}\t${u.name}${u.email ? `\t<${u.email}>` : ''}`);
  L.push('');
  L.push(`Воронки (${r.pipelines.length}):`);
  for (const p of r.pipelines) {
    L.push(`  ▸ [${p.id}] ${p.name}${p.isMain ? ' (главная)' : ''} — лидов: ${p.leadCount}${p.leadCountTruncated ? '+' : ''}`);
    for (const m of p.stageMapping) {
      const arrow = m.suggestedDmsStage ? `→ ${m.suggestedDmsStage}` : '→ (нет эквивалента)';
      L.push(`      · ${m.amoStatusName}  ${arrow}  [${m.verdict}]`);
    }
  }
  L.push('');
  L.push(`Кастом-поля (${r.customFields.length}):`);
  for (const e of ['leads', 'contacts', 'companies'] as const) {
    const fs = r.customFields.filter((f) => f.entity === e);
    L.push(`  ${e} (${fs.length}):`);
    for (const f of fs) L.push(`    · [${f.id}] ${f.name} (${f.type}${f.code ? `, code=${f.code}` : ''}${f.enumCount ? `, enum×${f.enumCount}` : ''})`);
  }
  L.push('');
  const q = r.dataQuality;
  L.push('Качество данных:');
  L.push(`  Лиды: всего ${q.leadsTotal}${q.leadsTruncated ? '+' : ''}; без ответственного ${q.leadsWithoutResponsible}; без воронки ${q.leadsWithoutPipeline}; без контактов ${q.leadsWithoutContacts}`);
  L.push(`  Контакты: всего ${q.contactsTotal}${q.contactsTruncated ? '+' : ''}; без имени ${q.contactsWithoutName}; без телефона/email ${q.contactsWithoutPhoneOrEmail}; без ответственного ${q.contactsWithoutResponsible}`);
  L.push(`  Компании: всего ${q.companiesTotal}${q.companiesTruncated ? '+' : ''}`);
  if (r.notes.length) {
    L.push('');
    L.push('Примечания:');
    for (const n of r.notes) L.push(`  ! ${n}`);
  }
  return L.join('\n');
}
