/**
 * Минимальный HS256 JWT (ADR-002): dev-провайдер аутентификации.
 * Форма claims совместима с Supabase (sub, email) — переход на Supabase
 * не меняет остальной код.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionClaims {
  sub: string; // user id
  email: string;
  iat: number;
  exp: number;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');

function sign(data: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(data).digest());
}

export function signSessionJwt(
  payload: { sub: string; email: string },
  secret: string,
  ttlSeconds = 8 * 3600, // session 8h (docs/11-security.md)
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify(claims)));
  return `${header}.${body}.${sign(`${header}.${body}`, secret)}`;
}

export function verifySessionJwt(token: string, secret: string): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${body}`, secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionClaims;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
