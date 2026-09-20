/**
 * ExternalReference — стабильные ссылки на записи внешних систем (amoCRM и др.) + идемпотентность.
 * «Ничего не терять»: одна внешняя запись ↔ одна строка (upsert по уникальному ключу
 * tenant+provider+entityType+externalId). Хранит raw источника и провенанс времени.
 *
 * Низкоуровневые функции берут tenantId явно — их вызывает sync-слой (server-side worker,
 * сеть к amoCRM только с сервера). Sync аудируется как единый прогон, не построчно.
 * UI-чтение — через ctx-гейт listExternalRefs (право tenant.settings), с tenant-изоляцией.
 */
import { requirePermission, type TenantContext } from '@finance-os/core';
import type { ExternalProvider, ExternalRefStatus, Prisma } from '@prisma/client';
import { prisma } from '../client.js';

export interface ExternalRefInput {
  provider: ExternalProvider;
  account: string;
  entityType: string;
  externalId: string | number;
  dmsType?: string | null;
  dmsId?: string | null;
  status?: ExternalRefStatus;
  raw?: unknown;
  note?: string | null;
  sourceCreatedAt?: Date | null;
  sourceUpdatedAt?: Date | null;
}

/** Идемпотентный upsert: повторный sync обновляет ту же строку, не создаёт дубль (BR sync). */
export async function upsertExternalRef(tenantId: string, input: ExternalRefInput) {
  const externalId = String(input.externalId);
  const data = {
    dmsType: input.dmsType ?? null,
    dmsId: input.dmsId ?? null,
    ...(input.status ? { status: input.status } : {}),
    ...(input.raw !== undefined ? { raw: input.raw as Prisma.InputJsonValue } : {}),
    note: input.note ?? null,
    sourceCreatedAt: input.sourceCreatedAt ?? null,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    syncedAt: new Date(),
  };
  return prisma.externalReference.upsert({
    where: { tenantId_provider_entityType_externalId: { tenantId, provider: input.provider, entityType: input.entityType, externalId } },
    create: { tenantId, provider: input.provider, account: input.account, entityType: input.entityType, externalId, ...data },
    update: data,
  });
}

/** Найти DMS-id по внешней ссылке (для dedup/idempotency при импорте). */
export async function findExternalRef(tenantId: string, provider: ExternalProvider, entityType: string, externalId: string | number) {
  return prisma.externalReference.findUnique({
    where: { tenantId_provider_entityType_externalId: { tenantId, provider, entityType, externalId: String(externalId) } },
  });
}

export async function setExternalRefStatus(tenantId: string, id: string, status: ExternalRefStatus, note?: string) {
  return prisma.externalReference.updateMany({ where: { id, tenantId }, data: { status, ...(note !== undefined ? { note } : {}) } });
}

export interface ExternalRefFilter { provider?: ExternalProvider; entityType?: string; status?: ExternalRefStatus }

/** Сводка по внешним ссылкам (для отчёта dry-run / админ-экрана). */
export async function countExternalRefs(tenantId: string, filter: ExternalRefFilter = {}) {
  return prisma.externalReference.count({ where: { tenantId, ...filter } });
}

/** UI-чтение (админ): tenant-изоляция + право tenant.settings. */
export async function listExternalRefs(ctx: TenantContext, filter: ExternalRefFilter = {}, limit = 200) {
  requirePermission(ctx, 'tenant.settings');
  return prisma.externalReference.findMany({
    where: { tenantId: ctx.tenantId, ...filter },
    orderBy: { syncedAt: 'desc' },
    take: limit,
  });
}
