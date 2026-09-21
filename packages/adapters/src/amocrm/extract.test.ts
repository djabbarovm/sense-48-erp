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
