/**
 * Slice 5 — Handover / move-in package (docs/24 §8/§9, docs/27 §6). REUSE-first, обратимо,
 * без новой схемы: пакет передачи фиксируется как аудируемая запись в timeline (маркер HANDOVER:JSON
 * на юните) + outbox-событие. Затем Services handoff (boundary, без Services OM).
 *
 * Protected documents (паспорт/ID/реквизиты): здесь — МИНИМАЛЬНАЯ обратимая реализация — храним
 * только ПРИЗНАК наличия (booleans), НЕ содержимое и не номера; доступ к деталям пакета — по праву
 * lease.view, запись — под withAudit. Реальное защищённое хранилище (storage/encryption/схема) —
 * осознанное решение позже (architecture boundary, не выдумываем юридических правил).
 */
import type { Prisma } from '@prisma/client';
import { requirePermission, ValidationError, type TenantContext } from '@finance-os/core';
import { prisma } from '../client.js';
import { withAudit } from '../audit.js';
import { findScopedOr404 } from '../repository.js';
import { emitDomainEvent } from './domainEvents.js';

export interface HandoverInput {
  actSigned?: boolean;
  conditionPhotos?: number;
  meters?: string; // показания счётчиков, свободный текст (не PII)
  keysCount?: number;
  accessCards?: number;
  moveInDate?: Date | null;
  // presence-only признаки защищённых документов (без содержимого/номеров)
  passportOnFile?: boolean;
  requisitesOnFile?: boolean;
  note?: string;
}

export interface HandoverRecord {
  actSigned: boolean;
  conditionPhotos: number;
  meters: string;
  keysCount: number;
  accessCards: number;
  moveInDate: string | null;
  passportOnFile: boolean;
  requisitesOnFile: boolean;
  recordedAt: string;
  complete: boolean;
}

const HANDOVER_PREFIX = 'HANDOVER:';

function toRecord(payload: Record<string, unknown>, recordedAt: Date): HandoverRecord {
  const r: HandoverRecord = {
    actSigned: !!payload.actSigned,
    conditionPhotos: Number(payload.conditionPhotos ?? 0),
    meters: String(payload.meters ?? ''),
    keysCount: Number(payload.keysCount ?? 0),
    accessCards: Number(payload.accessCards ?? 0),
    moveInDate: (payload.moveInDate as string) ?? null,
    passportOnFile: !!payload.passportOnFile,
    requisitesOnFile: !!payload.requisitesOnFile,
    recordedAt: recordedAt.toISOString(),
    complete: false,
  };
  r.complete = r.actSigned && r.conditionPhotos > 0 && r.keysCount > 0 && !!r.moveInDate;
  return r;
}

/** Зафиксировать фактическую передачу помещения (акт, фото состояния, счётчики, ключи, карты, move-in). */
export async function recordHandover(ctx: TenantContext, leaseId: string, input: HandoverInput) {
  requirePermission(ctx, 'lease.manage');
  if ((input.conditionPhotos ?? 0) < 0 || (input.keysCount ?? 0) < 0 || (input.accessCards ?? 0) < 0) throw new ValidationError('HANDOVER_NEGATIVE', 'HANDOVER_NEGATIVE: количества не могут быть отрицательными');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx: Prisma.TransactionClient) => {
    const lease = await findScopedOr404(tx.leaseContract, ctx, leaseId);
    const payload = {
      actSigned: !!input.actSigned,
      conditionPhotos: input.conditionPhotos ?? 0,
      meters: input.meters ?? '',
      keysCount: input.keysCount ?? 0,
      accessCards: input.accessCards ?? 0,
      moveInDate: input.moveInDate ? input.moveInDate.toISOString() : null,
      passportOnFile: !!input.passportOnFile,
      requisitesOnFile: !!input.requisitesOnFile,
    };
    await tx.unitActivity.create({ data: { tenantId: ctx.tenantId, unitId: lease.unitId, kind: 'NOTE', actorId: ctx.userId, note: `${HANDOVER_PREFIX}${JSON.stringify(payload)}${input.note ? ` — ${input.note}` : ''}` } });
    await emitDomainEvent(tx, ctx.tenantId, 'lease.handover', 'lease', leaseId, { unitId: lease.unitId, detail: 'handover recorded', deepLink: `/property/units/${lease.unitId}` });
    // presence защищённых документов пишем как отдельное аудит-поле (без содержимого)
    return { result: toRecord(payload, new Date()), audit: { action: 'lease.handover', objectType: 'lease', objectId: leaseId, after: payload } };
  });
}

/** Последний зафиксированный пакет передачи по юниту (детали — по праву lease.view). */
export async function getHandover(ctx: TenantContext, unitId: string): Promise<HandoverRecord | null> {
  requirePermission(ctx, 'lease.view');
  const act = await prisma.unitActivity.findFirst({ where: { tenantId: ctx.tenantId, unitId, note: { startsWith: HANDOVER_PREFIX } }, orderBy: { happenedAt: 'desc' } });
  if (!act) return null;
  const jsonPart = act.note.slice(HANDOVER_PREFIX.length).split(' — ')[0]!;
  try {
    return toRecord(JSON.parse(jsonPart) as Record<string, unknown>, act.happenedAt);
  } catch {
    return null;
  }
}

/** Services handoff после move-in: знакомим клиента с Services (boundary; без Services OM). */
export async function recordServicesHandoff(ctx: TenantContext, leaseId: string, note?: string) {
  requirePermission(ctx, 'lease.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx: Prisma.TransactionClient) => {
    const lease = await findScopedOr404(tx.leaseContract, ctx, leaseId);
    await tx.unitActivity.create({ data: { tenantId: ctx.tenantId, unitId: lease.unitId, kind: 'NOTE', actorId: ctx.userId, note: `SERVICES_HANDOFF${note ? `: ${note}` : ''}` } });
    await emitDomainEvent(tx, ctx.tenantId, 'services.handoff', 'lease', leaseId, { unitId: lease.unitId, detail: 'services handoff', deepLink: `/property/units/${lease.unitId}` });
    return { result: lease, audit: { action: 'lease.services_handoff', objectType: 'lease', objectId: leaseId, after: { handedToServices: true } } };
  });
}

/** Был ли Services handoff по юниту. */
export async function hasServicesHandoff(ctx: TenantContext, unitId: string): Promise<boolean> {
  requirePermission(ctx, 'lease.view');
  return (await prisma.unitActivity.count({ where: { tenantId: ctx.tenantId, unitId, note: { startsWith: 'SERVICES_HANDOFF' } } })) > 0;
}
