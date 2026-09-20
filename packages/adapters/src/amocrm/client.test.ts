import { describe, expect, it, vi } from 'vitest';
import { AmoCrmClient, AmoCrmError, amoBaseUrl } from './client.js';

const cfg = { subdomain: 'rooftophall', clientId: 'cid', clientSecret: 'super-secret-xyz', redirectUri: 'https://x/api/integrations/amocrm/callback' };

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe('AmoCrmClient — OAuth', () => {
  it('amoBaseUrl нормализует поддомен', () => {
    expect(amoBaseUrl('rooftophall')).toBe('https://rooftophall.amocrm.ru');
    expect(amoBaseUrl('rooftophall.amocrm.ru')).toBe('https://rooftophall.amocrm.ru');
  });

  it('exchangeCode парсит токены и считает expiresAt; POST на /oauth2/access_token', async () => {
    let calledUrl = '';
    const fetchImpl = vi.fn(async (u: string) => { calledUrl = String(u); return res(200, { token_type: 'Bearer', expires_in: 86400, access_token: 'AT', refresh_token: 'RT' }); });
    const c = new AmoCrmClient({ subdomain: cfg.subdomain, fetchImpl: fetchImpl as unknown as typeof fetch });
    const t = await c.exchangeCode(cfg, 'the-code');
    expect([t.accessToken, t.refreshToken, t.tokenType]).toEqual(['AT', 'RT', 'Bearer']);
    expect(t.expiresAt).toBeGreaterThan(Date.now());
    expect(calledUrl).toBe('https://rooftophall.amocrm.ru/oauth2/access_token');
  });

  it('refresh возвращает НОВЫЙ refresh_token (его надо сохранить)', async () => {
    const fetchImpl = vi.fn(async () => res(200, { token_type: 'Bearer', expires_in: 3600, access_token: 'AT2', refresh_token: 'RT2' }));
    const c = new AmoCrmClient({ subdomain: cfg.subdomain, fetchImpl: fetchImpl as unknown as typeof fetch });
    const t = await c.refresh(cfg, 'old-refresh');
    expect(t.refreshToken).toBe('RT2');
  });

  it('ошибка OAuth не раскрывает client_secret', async () => {
    const fetchImpl = vi.fn(async () => res(401, { error: 'invalid' }));
    const c = new AmoCrmClient({ subdomain: cfg.subdomain, fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(c.exchangeCode(cfg, 'bad')).rejects.toBeInstanceOf(AmoCrmError);
    try { await c.exchangeCode(cfg, 'bad'); } catch (e) { expect(String((e as Error).message)).not.toContain('super-secret-xyz'); }
  });
});

describe('AmoCrmClient — API', () => {
  it('429 → ретрай с учётом Retry-After, потом успех', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (u: string) => {
      calls.push(u);
      if (calls.length === 1) return res(429, {}, { 'retry-after': '1' });
      return res(200, { _embedded: { users: [{ id: 1, name: 'Умар' }] } });
    });
    const sleep = vi.fn(async () => {});
    const c = new AmoCrmClient({ subdomain: cfg.subdomain, fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: sleep });
    const users = await c.listUsers('AT');
    expect(users).toEqual([{ id: 1, name: 'Умар' }]);
    expect(sleep).toHaveBeenCalledWith(1000); // Retry-After: 1s
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('401 → AmoCrmError UNAUTHORIZED', async () => {
    const c = new AmoCrmClient({ subdomain: cfg.subdomain, fetchImpl: (async () => res(401, {})) as unknown as typeof fetch });
    await expect(c.listLeads('AT')).rejects.toMatchObject({ code: 'AMOCRM_UNAUTHORIZED' });
  });

  it('204 (пустая коллекция) → []', async () => {
    const c = new AmoCrmClient({ subdomain: cfg.subdomain, fetchImpl: (async () => res(204, null)) as unknown as typeof fetch });
    expect(await c.listContacts('AT')).toEqual([]);
  });

  it('пагинация: следует _links.next до конца', async () => {
    let page = 0;
    const fetchImpl = vi.fn(async () => {
      page++;
      if (page === 1) return res(200, { _embedded: { leads: [{ id: 1 }, { id: 2 }] }, _links: { next: { href: 'p2' } } });
      return res(200, { _embedded: { leads: [{ id: 3 }] } }); // нет next → конец
    });
    const c = new AmoCrmClient({ subdomain: cfg.subdomain, fetchImpl: fetchImpl as unknown as typeof fetch });
    const seen: number[][] = [];
    const leads = await c.listLeads('AT', (items, p) => { seen.push([p, items.length]); });
    expect(leads.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(seen).toEqual([[1, 2], [2, 1]]);
  });
});
