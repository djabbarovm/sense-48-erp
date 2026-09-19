import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { TenantContext } from '@finance-os/core';
import { NotFoundError, verifySessionJwt } from '@finance-os/core';
import { buildTenantContext, listUserTenants, prisma } from '@finance-os/db';

export const SESSION_COOKIE = 'fos_session';
export const TENANT_COOKIE = 'fos_tenant';

function jwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error('AUTH_JWT_SECRET is not set');
  return secret;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
}

/** Пользователь из cookie-сессии; null, если не залогинен. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = verifySessionJwt(token, jwtSecret());
  if (!claims) return null;
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, email: true, username: true, fullName: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') return null;
  return { id: user.id, email: user.email ?? user.username ?? '', fullName: user.fullName };
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/** TenantContext текущего запроса: пользователь из сессии + tenant из cookie/URL. */
export async function requireTenantContext(tenantSlug?: string): Promise<TenantContext> {
  const user = await requireSessionUser();
  const slug = tenantSlug ?? (await cookies()).get(TENANT_COOKIE)?.value;
  if (!slug) {
    const tenants = await listUserTenants(user.id);
    const first = tenants[0];
    if (!first) throw new NotFoundError();
    return buildTenantContext(user.id, first.slug);
  }
  return buildTenantContext(user.id, slug);
}

export async function getRequestMeta(): Promise<{ ip?: string; userAgent?: string }> {
  const h = await headers();
  const meta: { ip?: string; userAgent?: string } = {};
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ua = h.get('user-agent');
  if (ip) meta.ip = ip;
  if (ua) meta.userAgent = ua;
  return meta;
}
