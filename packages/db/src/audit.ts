import type { AuditLog } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { AuditEntry } from '@finance-os/core';
import { GENESIS_HASH, computeDiffHash, verifyChain } from '@finance-os/core';
import { prisma } from './client.js';

export interface AuditActor {
  tenantId: string;
  userId?: string | undefined;
  role?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * BR-070/071: запись в audit_log внутри транзакции мутации.
 * Advisory lock сериализует цепочку per tenant, чтобы prev_hash был корректен
 * при конкурентных транзакциях.
 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  actor: AuditActor,
  entry: AuditEntry,
): Promise<AuditLog> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'audit:' + actor.tenantId}))`;
  const last = await tx.auditLog.findFirst({
    where: { tenantId: actor.tenantId },
    orderBy: { seq: 'desc' },
    select: { diffHash: true },
  });
  const prevHash = last?.diffHash ?? GENESIS_HASH;
  const diffHash = computeDiffHash(prevHash, entry.before ?? null, entry.after ?? null);
  return tx.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      actorId: actor.userId ?? null,
      actorRole: actor.role ?? null,
      action: entry.action,
      objectType: entry.objectType,
      objectId: entry.objectId,
      before: entry.before == null ? Prisma.DbNull : (entry.before as Prisma.InputJsonValue),
      after: entry.after == null ? Prisma.DbNull : (entry.after as Prisma.InputJsonValue),
      diffHash,
      prevHash,
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    },
  });
}

/**
 * Единственная дверь для мутаций финансовых объектов: колбэк выполняет мутацию
 * и обязан вернуть AuditEntry (или их список) — иначе тип не сойдётся и
 * транзакция не соберётся. Мутация и audit-запись атомарны.
 */
export async function withAudit<T>(
  actor: AuditActor,
  fn: (tx: Prisma.TransactionClient) => Promise<{ result: T; audit: AuditEntry | AuditEntry[] }>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const { result, audit } = await fn(tx);
    const entries = Array.isArray(audit) ? audit : [audit];
    if (entries.length === 0) {
      throw new Error('withAudit: mutation must produce at least one audit entry (BR-070)');
    }
    for (const entry of entries) {
      await writeAudit(tx, actor, entry);
    }
    return result;
  });
}

/** BR-071: проверка целостности цепочки tenant'а по данным БД (используется daily job). */
export async function verifyAuditChain(tenantId: string) {
  const records = await prisma.auditLog.findMany({
    where: { tenantId },
    orderBy: { seq: 'asc' },
    select: { diffHash: true, prevHash: true, before: true, after: true },
  });
  return verifyChain(
    records.map((r) => ({
      diffHash: r.diffHash,
      prevHash: r.prevHash,
      before: r.before ?? null,
      after: r.after ?? null,
    })),
  );
}
