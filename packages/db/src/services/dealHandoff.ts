/**
 * Slice 2 — Handoff Умар → Азиз и Return to qualification (docs/23 §9, docs/24 §1).
 * REUSE-first, обратимо: используем существующие примитивы Deal/UnitActivity/AuditLog/DomainEvent,
 * НЕ создаём новую Intake-сущность (OPEN A). Передача = смена managerId + квалификация стадии +
 * next action + запись в timeline + outbox-событие (→ Telegram воркером). Возврат — типизированная
 * причина, сделка снова у колл-центра, timeline фиксирует (метрика качества КЦ).
 */
import type { Prisma } from '@prisma/client';
import { hasRole, NotFoundError, requirePermission, ValidationError, type TenantContext } from '@finance-os/core';
import { prisma } from '../client.js';
import { withAudit } from '../audit.js';
import { findScopedOr404 } from '../repository.js';
import { emitDomainEvent } from './domainEvents.js';

export const RETURN_REASONS = ['MISSING_DATA', 'WRONG_QUALIFICATION', 'WRONG_ROUTING', 'INVALID_CONTACT', 'OTHER'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

async function firstUserWithRole(tenantId: string, role: 'BROKER' | 'CALL_CENTER' | 'COMMERCIAL_DIRECTOR'): Promise<string | null> {
  const row = await prisma.userTenantRole.findFirst({ where: { tenantId, role }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
  return row?.userId ?? null;
}

/** Передать квалифицированную сделку брокеру (авто-assignment + push + timeline). Часть Умара завершена. */
export async function handoffDeal(ctx: TenantContext, dealId: string, opts: { brokerId?: string; note?: string } = {}, now = new Date()) {
  requirePermission(ctx, 'deal.manage');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx: Prisma.TransactionClient) => {
    const deal = await findScopedOr404(tx.deal, ctx, dealId);
    const brokerId = opts.brokerId ?? (await firstUserWithRole(ctx.tenantId, 'BROKER'));
    if (!brokerId) throw new ValidationError('NO_BROKER', 'NO_BROKER: нет брокера для передачи');
    const broker = await tx.user.findUnique({ where: { id: brokerId }, select: { fullName: true } });
    const nextActionAt = new Date(now.getTime() + 15 * 60_000);
    const after = await tx.deal.update({
      where: { id: dealId },
      data: {
        managerId: brokerId,
        stage: deal.stage === 'NEW' ? 'QUALIFIED' : deal.stage, // квалификация Умара
        stageChangedAt: now,
        nextAction: 'Связаться с клиентом (передано колл-центром)',
        nextActionAt,
        updatedBy: ctx.userId,
      },
    });
    await tx.unitActivity.create({ data: { tenantId: ctx.tenantId, dealId, kind: 'FOLLOW_UP', note: `HANDOFF→${broker?.fullName ?? 'broker'}${opts.note ? `: ${opts.note}` : ''}`, actorId: ctx.userId, followUpAt: nextActionAt, happenedAt: now } });
    await emitDomainEvent(tx, ctx.tenantId, 'deal.handoff', 'deal', dealId, { number: after.number, to: brokerId, detail: 'handoff from call-center', deepLink: `/deals/${dealId}` });
    return { result: after, audit: { action: 'deal.handoff', objectType: 'deal', objectId: dealId, before: { managerId: deal.managerId, stage: deal.stage }, after: { managerId: brokerId, stage: after.stage } } };
  });
}

/** Вернуть сделку колл-центру на переквалификацию с обязательной типизированной причиной (метрика качества КЦ). */
export async function returnToQualification(ctx: TenantContext, dealId: string, input: { reason: ReturnReason; note?: string }, now = new Date()) {
  requirePermission(ctx, 'deal.manage');
  if (!RETURN_REASONS.includes(input.reason)) throw new ValidationError('RETURN_REASON_REQUIRED', 'RETURN_REASON_REQUIRED: укажите причину возврата');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx: Prisma.TransactionClient) => {
    const deal = await findScopedOr404(tx.deal, ctx, dealId);
    // Брокер возвращает только свою сделку (BR-P21).
    if (hasRole(ctx, 'BROKER') && !hasRole(ctx, 'OWNER', 'COMMERCIAL_MANAGER', 'COMMERCIAL_DIRECTOR') && deal.managerId !== ctx.userId) throw new NotFoundError();
    const cc = await firstUserWithRole(ctx.tenantId, 'CALL_CENTER');
    const after = await tx.deal.update({
      where: { id: dealId },
      data: {
        managerId: cc ?? deal.managerId,
        stage: 'NEW',
        stageChangedAt: now,
        nextAction: `Переквалифицировать (${input.reason})`,
        nextActionAt: now,
        updatedBy: ctx.userId,
      },
    });
    await tx.unitActivity.create({ data: { tenantId: ctx.tenantId, dealId, kind: 'NOTE', note: `RETURN_TO_QUALIFICATION:${input.reason}${input.note ? ` — ${input.note}` : ''}`, actorId: ctx.userId, happenedAt: now } });
    await emitDomainEvent(tx, ctx.tenantId, 'deal.returned', 'deal', dealId, { number: after.number, reason: input.reason, to: after.managerId ?? '', detail: `return: ${input.reason}`, deepLink: `/deals/${dealId}` });
    return { result: after, audit: { action: 'deal.return_to_qualification', objectType: 'deal', objectId: dealId, before: { managerId: deal.managerId, stage: deal.stage }, after: { managerId: after.managerId, stage: 'NEW', reason: input.reason } } };
  });
}

/** Метрика качества КЦ: число возвратов на переквалификацию за период (по timeline-меткам). */
export async function countReturnsToQualification(ctx: TenantContext, sinceDays = 30, now = new Date()): Promise<number> {
  requirePermission(ctx, 'deal.view');
  const since = new Date(now.getTime() - sinceDays * 86_400_000);
  return prisma.unitActivity.count({ where: { tenantId: ctx.tenantId, kind: 'NOTE', note: { startsWith: 'RETURN_TO_QUALIFICATION:' }, happenedAt: { gte: since } } });
}
