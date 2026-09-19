/** Wave 2: API-ключи тенанта для внешних интерфейсов (docs/20 §11.3). Хранится только sha256, plaintext — один раз. */
import { createHash, randomBytes } from 'node:crypto';
import type { TenantContext } from '@finance-os/core';
import { ValidationError, requirePermission } from '@finance-os/core';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';

export const API_SCOPES = ['PUBLIC_INVENTORY', 'WORKBOT', 'LEADS', 'TELEPHONY'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');

export async function createApiKey(ctx: TenantContext, input: { name: string; scopes: ApiScope[] }): Promise<{ id: string; prefix: string; plaintext: string }> {
  requirePermission(ctx, 'apikey.manage');
  if (!input.name.trim()) throw new ValidationError('REQUIRED_FIELDS');
  const scopes = [...new Set(input.scopes)].filter((s) => (API_SCOPES as readonly string[]).includes(s));
  if (scopes.length === 0) throw new ValidationError('SCOPE_REQUIRED');
  const plaintext = `mds_${randomBytes(24).toString('base64url')}`;
  const prefix = plaintext.slice(0, 12);
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const created = await tx.apiKey.create({ data: { tenantId: ctx.tenantId, name: input.name.trim(), prefix, keyHash: hash(plaintext), scopes, createdBy: ctx.userId } });
    return {
      result: { id: created.id, prefix, plaintext },
      // сам ключ и его хэш в audit не попадают (docs/11)
      audit: { action: 'api_key.create', objectType: 'api_key', objectId: created.id, after: { name: created.name, prefix, scopes } },
    };
  });
}

export async function listApiKeys(ctx: TenantContext) {
  requirePermission(ctx, 'apikey.manage');
  return prisma.apiKey.findMany({ where: whereTenant(ctx), orderBy: { createdAt: 'desc' }, select: { id: true, name: true, prefix: true, scopes: true, createdAt: true, lastUsedAt: true, revokedAt: true } });
}

export async function revokeApiKey(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'apikey.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.apiKey, ctx, id);
    if (before.revokedAt) return { result: before, audit: { action: 'api_key.revoke', objectType: 'api_key', objectId: id, after: { alreadyRevoked: true } } };
    const after = await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return { result: after, audit: { action: 'api_key.revoke', objectType: 'api_key', objectId: id, before: { revokedAt: null }, after: { revokedAt: after.revokedAt } } };
  });
}

/** Проверка ключа из заголовка: активный ключ c нужным scope → tenantId; иначе null. Обновляет lastUsedAt. */
export async function verifyApiKey(raw: string | null | undefined, scope: ApiScope): Promise<{ tenantId: string; keyId: string } | null> {
  if (!raw || !raw.startsWith('mds_')) return null;
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hash(raw) } });
  if (!key || key.revokedAt || !key.scopes.includes(scope)) return null;
  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  return { tenantId: key.tenantId, keyId: key.id };
}
