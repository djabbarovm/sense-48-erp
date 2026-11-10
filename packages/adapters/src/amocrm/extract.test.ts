import { describe, expect, it } from 'vitest';
import { AmoCrmClient, amoBaseUrl } from './client.js';
import { describeTokenShape } from './config.js';
import { runAmoExtract, buildAmoTables, isoUtc } from './extract.js';

/** Мини-сервер amoCRM: одна страница на коллекцию (пагинация обрывается на пустой странице). */
function fakeAmo(): typeof fetch {
  const body = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
  return (async (input: string) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/api/v4/account')) return body({ id: 42, name: 'Rooftop Hall', subdomain: 'rooftophall' });
    if (path.endsWith('/api/v4/users')) return body({ _embedded: { users: [{ id: 1, name: 'Умар', email: 'umar@x.uz' }, { id: 2, name: 'Азиз' }] } });
    if (path.endsWith('/api/v4/leads/pipelines')) return body({ _embedded: { pipelines: [
      { id: 100, name: 'Продажа', sort: 1, is_main: true, _embedded: { statuses: [
        { id: 1000, name: 'Первичный контакт', sort: 1 },
        { id: 1001, name: 'Переговоры', sort: 2 },
        { id: 142, name: 'Успешно реализовано', sort: 3 },
        { id: 143, name: 'Закрыто и не реализовано', sort: 4 },
      ] } },
    ] } });
    if (path.endsWith('/api/v4/leads/custom_fields')) return body({ _embedded: { custom_fields: [
      { id: 70, name: 'Источник', type: 'select', code: null, enums: [{ id: 1, value: 'Instagram' }, { id: 2, value: 'Сайт' }] },
      { id: 71, name: 'Пустое поле', type: 'text', code: null, enums: null },
    ] } });
    if (path.includes('/custom_fields')) return body({ _embedded: { custom_fields: [] } });
    if (path.endsWith('/api/v4/leads')) return body({ _embedded: { leads: [
      { id: 1, name: 'Сделка А', pipeline_id: 100, status_id: 142, price: 500000, responsible_user_id: 1, created_at: 1700000000, updated_at: 1700100000, closed_at: 1700200000,
        _embedded: { contacts: [{ id: 9 }], tags: [{ id: 1, name: 'горячий' }] },
        custom_fields_values: [{ field_id: 70, field_name: 'Источник', values: [{ value: 'Instagram' }] }] },
      { id: 2, name: 'Сделка Б', pipeline_id: 100, status_id: 143, responsible_user_id: null, created_at: 1700005000,
        _embedded: { loss_reason: [{ id: 5, name: 'Дорого' }] } },
      { id: 3, name: 'Сделка В', pipeline_id: 100, status_id: 1001, price: 0, responsible_user_id: 1, created_at: 1700009000, _embedded: { contacts: [{ id: 9 }] } },
    ] } });
    if (path.endsWith('/api/v4/contacts')) return body({ _embedded: { contacts: [
      { id: 9, name: 'Иван', responsible_user_id: 1, custom_fields_values: [{ field_id: 1, field_code: 'PHONE', values: [{ value: '+998901112233' }] }] },
      { id: 10, name: '', responsible_user_id: null, custom_fields_values: null },
    ] } });
    if (path.endsWith('/api/v4/companies')) return body({ _embedded: { companies: [{ id: 5, name: 'ООО Пример' }] } });
    if (path.endsWith('/api/v4/tasks')) return body({ _embedded: { tasks: [
      { id: 1, responsible_user_id: 1, is_completed: true, created_at: 1700001000 },
      { id: 2, responsible_user_id: 1, is_completed: false, created_at: 1700002000 },
    ] } });
    if (path.endsWith('/api/v4/leads/notes')) return body({ _embedded: { notes: [
      { id: 1, entity_id: 1, note_type: 'call_out', created_by: 1, created_at: 1700003000 },
      { id: 2, entity_id: 1, note_type: 'call_in', created_by: 1, created_at: 1700004000 },
      { id: 3, entity_id: 2, note_type: 'common', created_by: 2, created_at: 1700004500 },
    ] } });
    if (path.endsWith('/api/v4/contacts/notes')) return body({ _embedded: { notes: [] } });
    if (path.endsWith('/api/v4/events')) return body({ _embedded: { events: [
      { id: 'e1', type: 'lead_status_changed', entity_id: 1, entity_type: 'lead', created_at: 1700050000, created_by: 1,
        value_before: [{ lead_status: { id: 1000, pipeline_id: 100 } }], value_after: [{ lead_status: { id: 1001, pipeline_id: 100 } }] },
      { id: 'e2', type: 'lead_status_changed', entity_id: 1, entity_type: 'lead', created_at: 1700060000, created_by: 1,
        value_before: [{ lead_status: { id: 1001, pipeline_id: 100 } }], value_after: [{ lead_status: { id: 142, pipeline_id: 100 } }] },
      { id: 'e3', type: 'lead_added', entity_id: 3, entity_type: 'lead', created_at: 1700009000, created_by: 1 },
    ] } });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
}

describe('amoBaseUrl / describeTokenShape', () => {
  it('amoBaseUrl: голый поддомен → .amocrm.ru, домен переключается, полный хост как есть', () => {
    expect(amoBaseUrl('rooftophall')).toBe('https://rooftophall.amocrm.ru');
    expect(amoBaseUrl('rooftophall', 'amocrm.com')).toBe('https://rooftophall.amocrm.com');
    expect(amoBaseUrl('rooftophall.kommo.com')).toBe('https://rooftophall.kommo.com');
    expect(amoBaseUrl('https://x.amocrm.com/')).toBe('https://x.amocrm.com');
  });
  it('describeTokenShape различает JWT / код авторизации / Bearer / пробелы, не раскрывая секрет', () => {
    expect(describeTokenShape('eyJhbGc.eyJzdWI.sig').kind).toBe('JWT_LONG_LIVED');
    expect(describeTokenShape('def50200abc').kind).toBe('AUTHORIZATION_CODE');
    expect(describeTokenShape('Bearer eyJx.y.z').kind).toBe('HAS_BEARER_PREFIX');
    expect(describeTokenShape('eyJx.y.z ').kind).toBe('HAS_WHITESPACE');
    expect(describeTokenShape('').kind).toBe('EMPTY');
  });
});

describe('AmoCrmClient — устойчивость к сетевым сбоям', () => {
  it('ретраит сетевой сбой (fetch failed) и затем успешно читает', async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      if (calls === 1) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ id: 1, name: 'ok', subdomain: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const client = new AmoCrmClient({ subdomain: 'x', fetchImpl: flaky, sleepImpl: async () => {}, retryBaseMs: 1 });
    const acc = await client.account('t');
    expect(acc).toEqual({ id: 1, name: 'ok', subdomain: 'x' });
    expect(calls).toBe(2);
  });
});

describe('amoCRM extract — изоляция сбоя сущности (PARTIAL, не теряем пакет)', () => {
  it('сбой на 2-й странице лидов → собранное сохранено, сущность PARTIAL, пакет строится', async () => {
    const body = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    const fetchImpl = (async (input: string) => {
      const u = new URL(String(input));
      const path = u.pathname; const page = u.searchParams.get('page');
      if (path.endsWith('/api/v4/account')) return body({ id: 1, name: 'X', subdomain: 'x' });
      if (path.endsWith('/api/v4/users')) return body({ _embedded: { users: [{ id: 1, name: 'U' }] } });
      if (path.endsWith('/api/v4/leads/pipelines')) return body({ _embedded: { pipelines: [{ id: 100, name: 'P', sort: 1, _embedded: { statuses: [{ id: 1000, name: 'Первичный контакт', sort: 1 }] } }] } });
      if (path.endsWith('/api/v4/leads')) {
        if (page === '1') return body({ _embedded: { leads: [{ id: 1, name: 'A', pipeline_id: 100, status_id: 1000, responsible_user_id: 1, created_at: 1700000000, _embedded: { contacts: [{ id: 9 }] } }] }, _links: { next: { href: 'x?page=2' } } });
        throw new TypeError('fetch failed'); // 2-я страница обрывается
      }
      if (path.includes('/custom_fields')) return body({ _embedded: { custom_fields: [] } });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const client = new AmoCrmClient({ subdomain: 'x', fetchImpl, sleepImpl: async () => {}, retryBaseMs: 1, maxRetries: 1 });
    const x = await runAmoExtract(client, 'secret-token');
    expect(x.deals).toHaveLength(1); // страница 1 сохранена, несмотря на сбой страницы 2
    const leadsVol = x.volumes.find((v) => v.entity === 'leads')!;
    expect(leadsVol.availability).toBe('PARTIAL');
    expect(x.notes.some((n) => n.includes('leads') && n.includes('прервано'))).toBe(true);
    expect(buildAmoTables(x).find((t) => t.sheet === 'Deals')!.rows).toHaveLength(1);
  });
});

describe('amoCRM extract — исторический экстракт (READ-ONLY, без выдумок)', () => {
  it('нормализует сделки с провенансом, временем и стадиями DMS', async () => {
    const client = new AmoCrmClient({ subdomain: 'rooftophall', fetchImpl: fakeAmo() });
    const x = await runAmoExtract(client, 'secret-token');

    expect(x.account).toEqual({ id: 42, name: 'Rooftop Hall', subdomain: 'rooftophall' });
    expect(x.deals).toHaveLength(3);
    const a = x.deals.find((d) => d.lead_id === 1)!;
    expect(a.is_won).toBe(true);
    expect(a.normalized_stage).toBe('WON');
    expect(a.provenance_source).toBe('AMOCRM');
    expect(a.source_stage_name).toBe('Успешно реализовано');
    expect(a.created_at).toBe(isoUtc(1700000000));
    expect(a.price_amount).toBe(500000);
    expect(a.source).toBe('Instagram');
    const b = x.deals.find((d) => d.lead_id === 2)!;
    expect(b.is_lost).toBe(true);
    expect(b.loss_reason).toBe('Дорого');
  });

  it('восстанавливает историю стадий из /events и помечает PARTIAL (не симулирует)', async () => {
    const client = new AmoCrmClient({ subdomain: 'rooftophall', fetchImpl: fakeAmo() });
    const x = await runAmoExtract(client, 'secret-token');
    expect(x.stageHistory).toHaveLength(2); // только lead_status_changed
    const first = x.stageHistory[0]!;
    expect(first.from_status_name).toBe('Первичный контакт');
    expect(first.to_status_name).toBe('Переговоры');
    expect(first.changed_at).toBe(isoUtc(1700050000));
    const funnelReached = x.funnel.find((f) => f.stage_id === 1001)!;
    expect(funnelReached.leads_ever_reached).toBe(1);
    expect(funnelReached.ever_reached_availability).toBe('PARTIAL');
  });

  it('активность агрегируется по пользователю (задачи/звонки), исход важнее счётчика', async () => {
    const client = new AmoCrmClient({ subdomain: 'rooftophall', fetchImpl: fakeAmo() });
    const x = await runAmoExtract(client, 'secret-token');
    const umar = x.activity.find((a) => a.user_id === 1)!;
    expect(umar.tasks_total).toBe(2);
    expect(umar.tasks_completed).toBe(1);
    expect(umar.calls_out).toBe(1);
    expect(umar.calls_in).toBe(1);
  });

  it('каталог кастом-полей: fill-rate + решение (IGNORE для пустого, KEEP_RAW/MAP для заполненного)', async () => {
    const client = new AmoCrmClient({ subdomain: 'rooftophall', fetchImpl: fakeAmo() });
    const x = await runAmoExtract(client, 'secret-token');
    const src = x.customFields.find((f) => f.field_id === 70)!;
    expect(src.filled_count).toBe(1);
    expect(src.decision).toBe('MAP'); // «Источник» — узнаваемый бизнес-атрибут
    const empty = x.customFields.find((f) => f.field_id === 71)!;
    expect(empty.filled_count).toBe(0);
    expect(empty.decision).toBe('IGNORE');
  });

  it('матрица готовности размечает AVAILABLE/PARTIAL/NOT_AVAILABLE и не раскрывает токен', async () => {
    const client = new AmoCrmClient({ subdomain: 'rooftophall', fetchImpl: fakeAmo() });
    const x = await runAmoExtract(client, 'secret-token');
    const unit = x.readiness.find((r) => r.metric.includes('Unit'))!;
    expect(unit.availability).toBe('NOT_AVAILABLE');
    const conv = x.readiness.find((r) => r.metric.includes('Конверсия'))!;
    expect(conv.availability).toBe('PARTIAL');

    const tables = buildAmoTables(x);
    const sheets = tables.map((t) => t.sheet);
    expect(sheets).toContain('Deals');
    expect(sheets).toContain('AnalyticsReadiness');
    expect(JSON.stringify(x)).not.toContain('secret-token');
  });
});

describe('amoCRM extract — область по воронкам и счёт общих статусов', () => {
  /** Две воронки (100 — ORDO, 200 — чужая); системный «успешно» (142) общий для обеих. */
  function twoPipelines(): { fetchImpl: typeof fetch; eventQueries: string[] } {
    const eventQueries: string[] = [];
    const body = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
    const fetchImpl = (async (input: string) => {
      const u = new URL(String(input));
      const path = u.pathname;
      if (path.endsWith('/api/v4/account')) return body({ id: 1, name: 'X', subdomain: 'x' });
      if (path.endsWith('/api/v4/users')) return body({ _embedded: { users: [{ id: 1, name: 'U' }] } });
      if (path.endsWith('/api/v4/leads/pipelines')) return body({ _embedded: { pipelines: [
        { id: 100, name: 'Piramit apartments', sort: 1, _embedded: { statuses: [{ id: 1000, name: 'Первичный контакт', sort: 1 }, { id: 142, name: 'Успешно реализовано', sort: 2 }] } },
        { id: 200, name: 'RoofTop Hall', sort: 2, _embedded: { statuses: [{ id: 2000, name: 'Первичный контакт', sort: 1 }, { id: 142, name: 'Успешно реализовано', sort: 2 }] } },
      ] } });
      if (path.includes('/custom_fields')) return body({ _embedded: { custom_fields: [] } });
      if (path.endsWith('/api/v4/leads')) return body({ _embedded: { leads: [
        { id: 1, pipeline_id: 100, status_id: 142, created_at: 1700000000, _embedded: { contacts: [{ id: 9 }] } },
        { id: 2, pipeline_id: 100, status_id: 1000, created_at: 1700000000 },
        { id: 3, pipeline_id: 200, status_id: 142, created_at: 1700000000, _embedded: { contacts: [{ id: 10 }] } },
        { id: 4, pipeline_id: 200, status_id: 142, created_at: 1700000000 },
      ] } });
      if (path.endsWith('/api/v4/contacts')) return body({ _embedded: { contacts: [{ id: 9, name: 'ORDO-клиент' }, { id: 10, name: 'Гость Rooftop' }] } });
      if (path.endsWith('/api/v4/companies')) return body({ _embedded: { companies: [{ id: 5, name: 'Не связана' }] } });
      if (path.endsWith('/api/v4/tasks')) return body({ _embedded: { tasks: [
        { id: 1, entity_type: 'leads', entity_id: 1, responsible_user_id: 1, created_at: 1700000000 },
        { id: 2, entity_type: 'leads', entity_id: 3, responsible_user_id: 1, created_at: 1700000000 },
      ] } });
      if (path.endsWith('/api/v4/leads/notes')) return body({ _embedded: { notes: [
        { id: 1, entity_id: 1, note_type: 'call_out', created_by: 1, created_at: 1700000000 },
        { id: 2, entity_id: 4, note_type: 'call_out', created_by: 1, created_at: 1700000000 },
      ] } });
      if (path.endsWith('/api/v4/contacts/notes')) return body({ _embedded: { notes: [] } });
      if (path.endsWith('/api/v4/events')) {
        eventQueries.push(u.searchParams.get('filter[type]') ?? '');
        return body({ _embedded: { events: [
          { id: 'e1', type: 'lead_status_changed', entity_id: 1, entity_type: 'lead', created_at: 1700050000, created_by: 1,
            value_before: [{ lead_status: { id: 1000, pipeline_id: 100 } }], value_after: [{ lead_status: { id: 142, pipeline_id: 100 } }] },
          { id: 'e2', type: 'lead_status_changed', entity_id: 3, entity_type: 'lead', created_at: 1700050000, created_by: 1,
            value_before: [{ lead_status: { id: 2000, pipeline_id: 200 } }], value_after: [{ lead_status: { id: 142, pipeline_id: 200 } }] },
        ] } });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    return { fetchImpl, eventQueries };
  }

  it('без области: «успешно» считается в своей воронке, а не во всех сразу', async () => {
    const { fetchImpl } = twoPipelines();
    const x = await runAmoExtract(new AmoCrmClient({ subdomain: 'x', fetchImpl }), 't');
    const won = (pid: number) => x.funnel.find((f) => f.pipeline_id === pid && f.stage_id === 142)!;
    expect(won(100).leads_currently_here).toBe(1);
    expect(won(200).leads_currently_here).toBe(2);
    expect(won(100).leads_ever_reached).toBe(1);
    expect(won(200).leads_ever_reached).toBe(1);
  });

  it('область по воронкам: остаются только сделки ORDO и связанное с ними', async () => {
    const { fetchImpl, eventQueries } = twoPipelines();
    const x = await runAmoExtract(new AmoCrmClient({ subdomain: 'x', fetchImpl }), 't', { pipelineIds: [100] });
    expect(x.deals.map((d) => d.lead_id).sort()).toEqual([1, 2]);
    expect(x.pipelines.map((p) => p.id)).toEqual([100]);
    expect(x.funnel.every((f) => f.pipeline_id === 100)).toBe(true);
    expect(x.stageHistory.map((h) => h.lead_id)).toEqual([1]);
    expect(x.summary['contacts_total']).toBe(1); // только контакт сделки ORDO
    expect(x.summary['companies_total']).toBe(0); // несвязанная компания отброшена
    expect(x.summary['tasks_total']).toBe(1);
    expect(x.summary['notes_total']).toBe(1);
    expect(String(x.summary['scope'])).toContain('Piramit apartments');
    expect(eventQueries).toContain('lead_status_changed'); // история стадий берётся фильтром по типу
  });
});
