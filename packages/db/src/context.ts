import type { RoleCode, TenantContext } from '@finance-os/core';
import { NotFoundError, unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from './client.js';

/**
 * Единственная фабрика TenantContext (BR-073): контекст строится только из
 * реальных записей UserTenantRole. Пользователь без роли в tenant получает 404
 * (политика docs/05: не раскрываем существование tenant).
 */
export async function buildTenantContext(userId: string, tenantSlug: string): Promise<TenantContext> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant || tenant.status !== 'ACTIVE') throw new NotFoundError();
  const roles = await prisma.userTenantRole.findMany({
    where: { userId, tenantId: tenant.id },
    select: { role: true },
  });
  if (roles.length === 0) throw new NotFoundError();
  return unsafeCreateTenantContext({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    userId,
    roles: roles.map((r) => r.role as RoleCode),
  });
}

/** Tenant'ы, доступные пользователю (для переключателя в шапке). */
export async function listUserTenants(userId: string) {
  const rows = await prisma.userTenantRole.findMany({
    where: { userId, tenant: { status: 'ACTIVE' } },
    select: { role: true, tenant: { select: { id: true, slug: true, legalName: true } } },
  });
  const bySlug = new Map<string, { slug: string; legalName: string; roles: RoleCode[] }>();
  for (const row of rows) {
    const existing = bySlug.get(row.tenant.slug);
    if (existing) existing.roles.push(row.role as RoleCode);
    else
      bySlug.set(row.tenant.slug, {
        slug: row.tenant.slug,
        legalName: row.tenant.legalName,
        roles: [row.role as RoleCode],
      });
  }
  return [...bySlug.values()];
}
