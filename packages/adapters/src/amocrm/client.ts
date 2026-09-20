/**
 * amoCRM API v4 клиент (READ-ONLY на первом этапе). Fetch инъектируется (тесты без сети),
 * как в HttpTelegramBotApi. Секреты (client_secret/токены) НЕ попадают в текст ошибок/логов.
 * OAuth (authorization_code / refresh_token) и long-lived token поддержаны оба.
 * Rate-limit (429) — ретрай с Retry-After. Пагинация — по _links.next / limit.
 */
import type {
  AmoTokens, AmoOAuthConfig, AmoPage,
  AmoUser, AmoPipeline, AmoContact, AmoCompany, AmoLead, AmoTask, AmoNote, AmoEvent, AmoCustomField,
} from './types.js';

export class AmoCrmError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'AmoCrmError';
  }
}

const OAUTH_PATH = '/oauth2/access_token';

/** База API из поддомена. Никаких секретов в URL. */
export function amoBaseUrl(subdomain: string): string {
  const s = subdomain.replace(/\.amocrm\.ru$/i, '').trim();
  return `https://${s}.amocrm.ru`;
}

interface ClientOpts {
  subdomain: string;
  fetchImpl?: typeof fetch;
  /** максимум ретраев на 429 (по умолчанию 3). */
  maxRetries?: number;
  /** пауза между ретраями по умолчанию, мс (если нет Retry-After). */
  retryBaseMs?: number;
  /** для тестов: не спать реально. */
  sleepImpl?: (ms: number) => Promise<void>;
}

export class AmoCrmClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: ClientOpts) {
    this.base = amoBaseUrl(opts.subdomain);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.sleep = opts.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  // ── OAuth ──
  private async token(body: Record<string, string>): Promise<AmoTokens> {
    const res = await this.fetchImpl(`${this.base}${OAUTH_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // тело может содержать hint, но не логируем секреты запроса
      throw new AmoCrmError(res.status, 'AMOCRM_OAUTH_FAILED', `AMOCRM_OAUTH_FAILED: HTTP ${res.status}`);
    }
    const j = (await res.json()) as { token_type: string; expires_in: number; access_token: string; refresh_token: string };
    return { tokenType: j.token_type, accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: Date.now() + j.expires_in * 1000 };
  }

  /** Обмен authorization_code → токены (первичное подключение). */
  exchangeCode(cfg: AmoOAuthConfig, code: string): Promise<AmoTokens> {
    return this.token({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri });
  }

  /** Обновление по refresh_token. Возвращает НОВЫЕ токены (в т.ч. новый refresh_token — его надо сохранить). */
  refresh(cfg: AmoOAuthConfig, refreshToken: string): Promise<AmoTokens> {
    return this.token({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken, redirect_uri: cfg.redirectUri });
  }

  // ── низкоуровневый GET c Bearer + ретрай 429 ──
  private async get<T = unknown>(path: string, accessToken: string, params: Record<string, string | number> = {}): Promise<T | null> {
    const url = new URL(`${this.base}/api/v4${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    let attempt = 0;
    for (;;) {
      const res = await this.fetchImpl(url.toString(), { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
      if (res.status === 204) return null; // amoCRM отдаёт 204 на пустую коллекцию
      if (res.status === 429 && attempt < this.maxRetries) {
        const ra = Number(res.headers.get('retry-after')) || 0;
        await this.sleep(ra > 0 ? ra * 1000 : this.retryBaseMs * (attempt + 1));
        attempt++;
        continue;
      }
      if (res.status === 401) throw new AmoCrmError(401, 'AMOCRM_UNAUTHORIZED', 'AMOCRM_UNAUTHORIZED: токен недействителен/истёк');
      if (!res.ok) throw new AmoCrmError(res.status, 'AMOCRM_API_ERROR', `AMOCRM_API_ERROR: GET ${path} → HTTP ${res.status}`);
      return (await res.json()) as T;
    }
  }

  /** Одна страница коллекции из _embedded[key]. */
  async page<T>(path: string, accessToken: string, embeddedKey: string, opts: { page?: number; limit?: number; with?: string; params?: Record<string, string | number> } = {}): Promise<AmoPage<T>> {
    const limit = opts.limit ?? 250;
    const body = await this.get<{ _embedded?: Record<string, T[]>; _links?: { next?: { href: string } } }>(path, accessToken, {
      page: opts.page ?? 1, limit, ...(opts.with ? { with: opts.with } : {}), ...(opts.params ?? {}),
    });
    if (!body) return { items: [], hasNext: false, nextPage: null };
    const items = (body._embedded?.[embeddedKey] ?? []) as T[];
    const hasNext = !!body._links?.next;
    return { items, hasNext, nextPage: hasNext ? (opts.page ?? 1) + 1 : null };
  }

  /** Все страницы коллекции (следуя _links.next). onPage — колбэк на каждую страницу (для стриминга/лимитов). */
  async all<T>(path: string, accessToken: string, embeddedKey: string, opts: { limit?: number; with?: string; maxPages?: number; params?: Record<string, string | number>; onPage?: (items: T[], page: number) => void | Promise<void> } = {}): Promise<T[]> {
    const out: T[] = [];
    let page = 1;
    const maxPages = opts.maxPages ?? 1000;
    for (; page <= maxPages; page++) {
      const p = await this.page<T>(path, accessToken, embeddedKey, { page, ...(opts.limit ? { limit: opts.limit } : {}), ...(opts.with ? { with: opts.with } : {}), ...(opts.params ? { params: opts.params } : {}) });
      out.push(...p.items);
      if (opts.onPage) await opts.onPage(p.items, page);
      if (!p.hasNext || p.items.length === 0) break;
    }
    return out;
  }

  // ── типизированные READ-методы ──
  listUsers(t: string) { return this.all<AmoUser>('/users', t, 'users'); }
  listPipelines(t: string) { return this.all<AmoPipeline>('/leads/pipelines', t, 'pipelines'); }
  listContacts(t: string, onPage?: (i: AmoContact[], p: number) => void | Promise<void>) { return this.all<AmoContact>('/contacts', t, 'contacts', { with: 'companies', ...(onPage ? { onPage } : {}) }); }
  listCompanies(t: string, onPage?: (i: AmoCompany[], p: number) => void | Promise<void>) { return this.all<AmoCompany>('/companies', t, 'companies', onPage ? { onPage } : {}); }
  listLeads(t: string, onPage?: (i: AmoLead[], p: number) => void | Promise<void>) { return this.all<AmoLead>('/leads', t, 'leads', { with: 'contacts,loss_reason', ...(onPage ? { onPage } : {}) }); }
  listTasks(t: string) { return this.all<AmoTask>('/tasks', t, 'tasks'); }
  listNotes(t: string, entity: 'leads' | 'contacts' | 'companies') { return this.all<AmoNote>(`/${entity}/notes`, t, 'notes'); }
  listEvents(t: string, params?: Record<string, string | number>) { return this.all<AmoEvent>('/events', t, 'events', params ? { params } : {}); }
  listCustomFields(t: string, entity: 'leads' | 'contacts' | 'companies') { return this.all<AmoCustomField>(`/${entity}/custom_fields`, t, 'custom_fields'); }
  /** Проверка доступа/аккаунта (лёгкий запрос для health/connect). */
  account(t: string) { return this.get<{ id: number; name: string; subdomain: string }>('/account', t); }
}
