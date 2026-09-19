'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { checkRateLimit, signSessionJwt, verifyPassword } from '@finance-os/core';
import { listUserTenants, prisma } from '@finance-os/db';
import { SESSION_COOKIE, TENANT_COOKIE } from './session';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'invalid_credentials' };

  // G-01: rate limiting логина — 10 попыток / 5 минут на IP+email
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const limit = checkRateLimit(`login:${ip}:${email}`, 10, 300);
  if (!limit.allowed) return { error: 'rate_limited' };

  // P-31: вход по email или системному логину (сотрудники без email)
  const login = email.trim().toLowerCase();
  const user = await prisma.user.findFirst({ where: { OR: [{ email: login }, { username: login }] } });
  if (!user || user.status !== 'ACTIVE' || !user.passwordHash) return { error: 'invalid_credentials' };
  if (!(await verifyPassword(password, user.passwordHash))) return { error: 'invalid_credentials' };

  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error('AUTH_JWT_SECRET is not set');
  const token = signSessionJwt({ sub: user.id, email: user.email ?? user.username ?? user.id }, secret);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // AUTH_COOKIE_SECURE=false — временный режим для доступа по IP без TLS
    // (H-06); c доменом и HTTPS переменная убирается и cookie снова secure.
    secure: process.env.AUTH_COOKIE_SECURE ? process.env.AUTH_COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
    maxAge: 8 * 3600,
    path: '/',
  });
  const tenants = await listUserTenants(user.id);
  // Cookie tenant'а от предыдущего пользователя в этом браузере сбрасывается, если у нового нет там роли
  // (иначе каждая страница падала бы на buildTenantContext → 404/500).
  const current = jar.get(TENANT_COOKIE)?.value;
  if (tenants[0] && (!current || !tenants.some((t) => t.slug === current))) {
    jar.set(TENANT_COOKIE, tenants[0].slug, { sameSite: 'lax', path: '/' });
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}

/** Переключатель tenant: только на tenant, где у пользователя есть роль. */
export async function switchTenantAction(formData: FormData): Promise<void> {
  const slug = String(formData.get('tenant') ?? '');
  const { requireSessionUser } = await import('./session');
  const user = await requireSessionUser();
  const tenants = await listUserTenants(user.id);
  if (!tenants.some((t) => t.slug === slug)) return;
  (await cookies()).set(TENANT_COOKIE, slug, { sameSite: 'lax', path: '/' });
  redirect('/');
}
