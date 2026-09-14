/** F-07: Audit viewer — фильтруемое чтение журнала (audit.view). */
import type { TenantContext } from '@finance-os/core';
import { requirePermission } from '@finance-os/core';
import { prisma } from '../client.js';
import { whereTenant } from '../repository.js';

export interface AuditFilter {
  objectType?: string;
  objectId?: string;
  action?: string;
  actorId?: string;
  take?: number;
}

export async function listAuditLog(ctx: TenantContext, filter: AuditFilter = {}) {
  requirePermission(ctx, 'audit.view');
  const records = await prisma.auditLog.findMany({
    where: whereTenant(ctx, {
      ...(filter.objectType ? { objectType: filter.objectType } : {}),
      ...(filter.objectId ? { objectId: filter.objectId } : {}),
      ...(filter.action ? { action: { contains: filter.action } } : {}),
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
    }),
    orderBy: { seq: 'desc' },
    take: Math.min(filter.take ?? 100, 300),
  });
  const actorIds = [...new Set(records.map((r) => r.actorId).filter((a): a is string => !!a))];
  const users = new Map(
    (await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]),
  );
  return records.map((record) => ({ ...record, actorName: record.actorId ? (users.get(record.actorId) ?? null) : null }));
}

export async function listAuditObjectTypes(ctx: TenantContext): Promise<string[]> {
  requirePermission(ctx, 'audit.view');
  const rows = await prisma.auditLog.groupBy({ by: ['objectType'], where: { tenantId: ctx.tenantId } });
  return rows.map((r) => r.objectType).sort();
}
