/**
 * F-05: Portfolio — сводка по всем компаниям пользователя (сервисная команда).
 * Данные строго по membership: только tenants, где у пользователя есть роль.
 */
import { prisma } from '../client.js';

export interface PortfolioRow {
  tenantId: string;
  slug: string;
  legalName: string;
  roles: string[];
  batchesToday: number;
  blockedPayments: number;
  overdueTasks: number;
  unmatchedTx: number;
  readyPayments: number;
}

export async function getPortfolio(userId: string, now = new Date()): Promise<PortfolioRow[]> {
  const memberships = await prisma.userTenantRole.findMany({
    where: { userId },
    include: { tenant: true },
  });
  const byTenant = new Map<string, { tenant: (typeof memberships)[number]['tenant']; roles: string[] }>();
  for (const membership of memberships) {
    const entry = byTenant.get(membership.tenantId) ?? { tenant: membership.tenant, roles: [] };
    entry.roles.push(membership.role);
    byTenant.set(membership.tenantId, entry);
  }
  const today = new Date(now.toISOString().slice(0, 10));
  const rows: PortfolioRow[] = [];
  for (const [tenantId, { tenant, roles }] of byTenant) {
    const [batchesToday, blocked, overdueTasks, unmatchedTx, ready] = await Promise.all([
      prisma.paymentBatch.count({ where: { tenantId, batchDate: today, status: { not: 'CANCELLED' } } }),
      prisma.paymentRequest.count({ where: { tenantId, status: 'ON_HOLD' } }),
      prisma.task.count({ where: { tenantId, status: 'OVERDUE' } }),
      prisma.bankTransaction.count({ where: { tenantId, matchStatus: { in: ['UNMATCHED', 'SUGGESTED'] } } }),
      prisma.paymentRequest.count({ where: { tenantId, status: 'READY_FOR_BATCH' } }),
    ]);
    rows.push({
      tenantId,
      slug: tenant.slug,
      legalName: tenant.legalName,
      roles,
      batchesToday,
      blockedPayments: blocked,
      overdueTasks,
      unmatchedTx,
      readyPayments: ready,
    });
  }
  return rows.sort((a, b) => a.slug.localeCompare(b.slug));
}
