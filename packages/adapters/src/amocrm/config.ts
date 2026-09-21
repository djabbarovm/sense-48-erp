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
}

/** Есть ли достаточно для READ-ONLY подключения по long-lived токену. */
export function hasAmoLongToken(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.AMOCRM_SUBDOMAIN && env.AMOCRM_LONG_TOKEN);
}

/** Прочитать long-lived конфиг из ENV или бросить понятную (без секрета) ошибку. */
export function readAmoLongToken(env: NodeJS.ProcessEnv = process.env): AmoLongTokenConfig {
  const subdomain = env.AMOCRM_SUBDOMAIN?.trim();
  const accessToken = env.AMOCRM_LONG_TOKEN?.trim();
  if (!subdomain) throw new Error('AMOCRM_SUBDOMAIN не задан в окружении');
  if (!accessToken) throw new Error('AMOCRM_LONG_TOKEN не задан в окружении');
  return { subdomain, accessToken };
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
