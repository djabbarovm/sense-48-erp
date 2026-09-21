/**
 * Конфиг amoCRM только из ENV (server-side). Секреты НЕ хардкодим, НЕ логируем, НЕ отдаём клиенту.
 *   AMOCRM_SUBDOMAIN   — поддомен аккаунта (напр. rooftophall)
 *   AMOCRM_LONG_TOKEN  — долгосрочный токен (long-lived Bearer, READ-ONLY этап)
 * OAuth-параметры (для будущего authorization_code) — опциональны и тоже только из ENV.
 */
import type { AmoOAuthConfig } from './types.js';

export interface AmoLongTokenConfig {
  subdomain: string;
  accessToken: string;
  /** домен аккаунта: amocrm.ru (умолч.) | amocrm.com | kommo.com. */
  domain: string;
}

/** Есть ли достаточно для READ-ONLY подключения по long-lived токену. */
export function hasAmoLongToken(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.AMOCRM_SUBDOMAIN && env.AMOCRM_LONG_TOKEN);
}

/** Прочитать long-lived конфиг из ENV или бросить понятную (без секрета) ошибку. */
export function readAmoLongToken(env: NodeJS.ProcessEnv = process.env): AmoLongTokenConfig {
  const subdomain = env.AMOCRM_SUBDOMAIN?.trim();
  const accessToken = env.AMOCRM_LONG_TOKEN?.trim();
  const domain = env.AMOCRM_DOMAIN?.trim() || 'amocrm.ru';
  if (!subdomain) throw new Error('AMOCRM_SUBDOMAIN не задан в окружении');
  if (!accessToken) throw new Error('AMOCRM_LONG_TOKEN не задан в окружении');
  return { subdomain, accessToken, domain };
}

/**
 * Диагностика формы токена БЕЗ раскрытия секрета. Возвращает вердикт + подсказку,
 * чтобы понять типичные ошибки вставки (авторизационный код вместо токена, префикс Bearer, пробелы).
 */
export interface TokenShape {
  kind: 'JWT_LONG_LIVED' | 'AUTHORIZATION_CODE' | 'HAS_BEARER_PREFIX' | 'HAS_WHITESPACE' | 'EMPTY' | 'UNKNOWN';
  length: number;
  ok: boolean;
  hint: string;
}
export function describeTokenShape(raw: string | undefined | null): TokenShape {
  const t = raw ?? '';
  if (t.trim() === '') return { kind: 'EMPTY', length: 0, ok: false, hint: 'токен пустой' };
  if (/^bearer\s/i.test(t)) return { kind: 'HAS_BEARER_PREFIX', length: t.length, ok: false, hint: 'убери префикс "Bearer " — в секрет кладётся только сам токен' };
  if (t !== t.trim() || /\s/.test(t)) return { kind: 'HAS_WHITESPACE', length: t.length, ok: false, hint: 'в токене есть пробел/перенос строки — скопировался лишний символ' };
  if (/^def5[0-9a-f]/i.test(t)) return { kind: 'AUTHORIZATION_CODE', length: t.length, ok: false, hint: 'это КОД авторизации (def502...), а не долгосрочный токен. Нужен долгосрочный токен из вкладки интеграции' };
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(t)) return { kind: 'JWT_LONG_LIVED', length: t.length, ok: true, hint: 'форма верная (JWT). Если 401 — проверь поддомен/домен (.ru vs .com) и что токен не отозван' };
  return { kind: 'UNKNOWN', length: t.length, ok: false, hint: 'форма не распознана — долгосрочный токен amoCRM выглядит как eyJ....(три части через точку)' };
}

/** OAuth-конфиг из ENV (для authorization_code/refresh — второй этап). redirectUri по умолчанию — /api/integrations/amocrm/callback. */
export function readAmoOAuthConfig(env: NodeJS.ProcessEnv = process.env): AmoOAuthConfig | null {
  const subdomain = env.AMOCRM_SUBDOMAIN?.trim();
  const clientId = env.AMOCRM_CLIENT_ID?.trim();
  const clientSecret = env.AMOCRM_CLIENT_SECRET?.trim();
  if (!subdomain || !clientId || !clientSecret) return null;
  const publicHost = env.PUBLIC_HOST?.trim();
  const redirectUri = env.AMOCRM_REDIRECT_URI?.trim()
    ?? (publicHost ? `https://${publicHost}/api/integrations/amocrm/callback` : '');
  return { subdomain, clientId, clientSecret, redirectUri };
}
