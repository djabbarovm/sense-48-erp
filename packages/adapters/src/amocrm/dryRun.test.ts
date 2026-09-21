import { describe, expect, it } from 'vitest';
import { AmoCrmClient } from './client.js';
import { runAmoDryRun, suggestStageMapping, formatAmoDryRun } from './dryRun.js';

/** Мини-сервер amoCRM на инъектируемом fetch: отдаёт по одной странице на коллекцию. */
function fakeAmo(): typeof fetch {
  const body = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });
  return (async (input: string) => {
    const url = String(input);
    const path = new URL(url).pathname;
    if (path.endsWith('/api/v4/account')) return body({ id: 42, name: 'Rooftop Hall', subdomain: 'rooftophall' });
    if (path.endsWith('/api/v4/users')) return body({ _embedded: { users: [{ id: 1, name: 'Умар', email: 'umar@x.uz' }, { id: 2, name: 'Азиз' }] } });
    if (path.endsWith('/api/v4/leads/pipelines')) return body({ _embedded: { pipelines: [
      { id: 100, name: 'Аренда', sort: 1, is_main: true, _embedded: { statuses: [
        { id: 1000, name: 'Первичный контакт', sort: 1 },
        { id: 1001, name: 'Переговоры', sort: 2 },
        { id: 142, name: 'Успешно реализовано', sort: 3 },
        { id: 143, name: 'Закрыто и не реализовано', sort: 4 },
        { id: 1002, name: 'Ждём предоплату', sort: 5 },
      ] } },
    ] } });
    if (path.includes('/custom_fields')) {
      const ent = path.split('/api/v4/')[1]!.split('/')[0];
      return body({ _embedded: { custom_fields: [{ id: 7, name: `Поле ${ent}`, type: 'text', code: null, enums: null }] } });
    }
    if (path.endsWith('/api/v4/leads')) return body({ _embedded: { leads: [
      { id: 1, pipeline_id: 100, status_id: 1000, responsible_user_id: 1, _embedded: { contacts: [{ id: 9 }] } },
      { id: 2, pipeline_id: 100, status_id: 1001, _embedded: {} }, // без ответственного, без контактов
    ] } });
    if (path.endsWith('/api/v4/contacts')) return body({ _embedded: { contacts: [
      { id: 9, name: 'Иван', responsible_user_id: 1, custom_fields_values: [{ field_id: 1, field_code: 'PHONE', values: [{ value: '+998901112233' }] }] },
      { id: 10, name: '', responsible_user_id: null, custom_fields_values: null }, // без имени, без телефона, без ответственного
    ] } });
    if (path.endsWith('/api/v4/companies')) return body({ _embedded: { companies: [{ id: 5, name: 'ООО Пример' }] } });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
}

describe('amoCRM dry-run — READ-ONLY каталог + качество данных', () => {
  it('suggestStageMapping: системные статусы → MATCH, ключевые слова → MAPPABLE, мусор → NO_EQUIVALENT', () => {
    expect(suggestStageMapping('Успешно реализовано')).toEqual({ stage: 'WON', verdict: 'MATCH' });
    expect(suggestStageMapping('Закрыто и не реализовано')).toEqual({ stage: 'LOST', verdict: 'MATCH' });
    expect(suggestStageMapping('Переговоры')).toEqual({ stage: 'NEGOTIATION', verdict: 'MAPPABLE' });
    expect(suggestStageMapping('Первичный контакт')).toEqual({ stage: 'NEW', verdict: 'MAPPABLE' });
    expect(suggestStageMapping('Ждём предоплату')).toEqual({ stage: 'LOI', verdict: 'MAPPABLE' });
    expect(suggestStageMapping('Абракадабра').verdict).toBe('NO_EQUIVALENT');
  });

  it('runAmoDryRun собирает каталог, объёмы и качество, ничего не записывая', async () => {
    const client = new AmoCrmClient({ subdomain: 'rooftophall', fetchImpl: fakeAmo() });
    const r = await runAmoDryRun(client, 'long-token');

    expect(r.account).toEqual({ id: 42, name: 'Rooftop Hall', subdomain: 'rooftophall' });
    expect(r.users).toHaveLength(2);
    expect(r.users[0]).toEqual({ id: 1, name: 'Умар', email: 'umar@x.uz' });
    expect(r.users[1]!.email).toBeNull();

    expect(r.pipelines).toHaveLength(1);
    const p = r.pipelines[0]!;
    expect(p.id).toBe(100);
    expect(p.isMain).toBe(true);
    expect(p.leadCount).toBe(2);
    const won = p.stageMapping.find((m) => m.amoStatusId === 142)!;
    expect(won).toMatchObject({ suggestedDmsStage: 'WON', verdict: 'MATCH' });

    // custom fields по трём сущностям
    expect(r.customFields.map((f) => f.entity).sort()).toEqual(['companies', 'contacts', 'leads']);

    const q = r.dataQuality;
    expect(q.leadsTotal).toBe(2);
    expect(q.leadsWithoutResponsible).toBe(1);
    expect(q.leadsWithoutContacts).toBe(1);
    expect(q.contactsTotal).toBe(2);
    expect(q.contactsWithoutName).toBe(1);
    expect(q.contactsWithoutPhoneOrEmail).toBe(1);
    expect(q.contactsWithoutResponsible).toBe(1);
    expect(q.companiesTotal).toBe(1);

    // отчёт печатается без секрета
    const text = formatAmoDryRun(r);
    expect(text).toContain('Rooftop Hall');
    expect(text).not.toContain('long-token');
  });
});
