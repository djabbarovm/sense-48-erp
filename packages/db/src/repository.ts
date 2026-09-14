import type { TenantContext } from '@finance-os/core';
import { NotFoundError } from '@finance-os/core';

/**
 * База tenant-scoped доступа (BR-073). Каждый метод требует TenantContext —
 * вызов без него не компилируется. Объект чужого tenant неотличим от
 * несуществующего: NotFoundError (→404).
 */

export interface TenantScopedDelegate<T extends { tenantId: string }> {
  findFirst(args: { where: { id: string; tenantId: string } }): Promise<T | null>;
}

/** findFirst по (id, tenant_id) — 404, если нет или чужой tenant. */
export async function findScopedOr404<T extends { tenantId: string }>(
  delegate: TenantScopedDelegate<T>,
  ctx: TenantContext,
  id: string,
): Promise<T> {
  const row = await delegate.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!row) throw new NotFoundError();
  return row;
}

/** where-помощник: гарантирует фильтр по tenant из контекста. */
export function whereTenant<W extends object>(ctx: TenantContext, where?: W): W & { tenantId: string } {
  return { ...(where ?? ({} as W)), tenantId: ctx.tenantId };
}
