'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { signSessionJwt, verifyPassword } from '@finance-os/core';
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

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE' || !user.passwordHash) return { error: 'invalid_credentials' };
  if (!(await verifyPassword(password, user.passwordHash))) return { error: 'invalid_credentials' };

  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error('AUTH_JWT_SECRET is not set');
  const token = signSessionJwt({ sub: user.id, email: user.email }, secret);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 3600,
    path: '/',
  });
  const tenants = await listUserTenants(user.id);
  if (tenants[0] && !jar.get(TENANT_COOKIE)) {
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
