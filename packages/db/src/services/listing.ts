/**
 * Slice 4 — Listing / fund workflow (docs/24 §3/§6, docs/27 §6.4). REUSE-first, обратимо,
 * без отдельной Listing-сущности (architecture boundary): собираем lifecycle поверх Unit + UnitActivity.
 * Обязательное: история цены (маркер PRICE в timeline), источник решения = собственник (FIXED-3),
 * Marketing handoff (запрос медиа → media ready → публикация), days on market и stale listing.
 * Финальную цену определяет собственник; Азиз консультирует и фиксирует (unit.publish/unit.pricing.edit).
 */
import type { Prisma } from '@prisma/client';
import { can, requirePermission, ValidationError, type TenantContext } from '@finance-os/core';
import { prisma } from '../client.js';
import { withAudit } from '../audit.js';
import { findScopedOr404 } from '../repository.js';
import { emitDomainEvent } from './domainEvents.js';
import { getTowerThresholds } from './towerSettings.js';

export const PRICE_SOURCES = ['OWNER', 'BROKER_RECOMMENDATION'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

const money = (v: bigint | null | undefined) => (v == null ? '—' : v.toString());

/** Зафиксировать согласованную с собственником цену/ставку (история + источник). */
export async function recordPriceDecision(
  ctx: TenantContext,
  unitId: string,
  input: { askingRateMinor?: bigint | null; minApprovedRateMinor?: bigint | null; salePriceMinor?: bigint | null; source?: PriceSource; note?: string },
) {
  // Цену определяет собственник; фиксировать может брокер (unit.publish) или коммерция (unit.pricing.edit).
  if (!can(ctx, 'unit.pricing.edit') && !can(ctx, 'unit.publish')) requirePermission(ctx, 'unit.pricing.edit');
  const source: PriceSource = input.source ?? 'OWNER';
  for (const v of [input.askingRateMinor, input.minApprovedRateMinor, input.salePriceMinor]) {
    if (v != null && v < 0n) throw new ValidationError('PRICE_NEGATIVE', 'PRICE_NEGATIVE: цена не может быть отрицательной');
  }
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx: Prisma.TransactionClient) => {
    const before = await findScopedOr404(tx.unit, ctx, unitId);
    const after = await tx.unit.update({
      where: { id: unitId },
      data: {
        ...(input.askingRateMinor !== undefined ? { askingRateMinor: input.askingRateMinor } : {}),
        ...(input.minApprovedRateMinor !== undefined ? { minApprovedRateMinor: input.minApprovedRateMinor } : {}),
        ...(input.salePriceMinor !== undefined ? { salePriceMinor: input.salePriceMinor } : {}),
        updatedBy: ctx.userId,
      },
    });
    // История цены в timeline (маркер PRICE:src=…); источник решения — собственник.
    await tx.unitActivity.create({
      data: {
        tenantId: ctx.tenantId, unitId, kind: 'NOTE', actorId: ctx.userId,
        note: `PRICE:src=${source};asking=${money(before.askingRateMinor)}->${money(after.askingRateMinor)};sale=${money(before.salePriceMinor)}->${money(after.salePriceMinor)}${input.note ? ` — ${input.note}` : ''}`,
      },
    });
    return {
      result: after,
      audit: { action: 'unit.price.decision', objectType: 'unit', objectId: unitId, before: { askingRateMinor: money(before.askingRateMinor), salePriceMinor: money(before.salePriceMinor) }, after: { askingRateMinor: money(after.askingRateMinor), salePriceMinor: money(after.salePriceMinor), source } },
    };
  });
}

/** Marketing handoff: запросить медиа-пакет (проф. фото/видео) — boundary с Marketing, без их OM. */
export async function requestMarketingMedia(ctx: TenantContext, unitId: string, note?: string) {
  requirePermission(ctx, 'unit.publish');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx: Prisma.TransactionClient) => {
    const unit = await findScopedOr404(tx.unit, ctx, unitId);
    await tx.unitActivity.create({ data: { tenantId: ctx.tenantId, unitId, kind: 'NOTE', actorId: ctx.userId, note: `MARKETING_HANDOFF:requested${note ? ` — ${note}` : ''}` } });
    await emitDomainEvent(tx, ctx.tenantId, 'marketing.media.requested', 'unit', unitId, { unitNo: unit.unitNo, detail: 'media requested', deepLink: `/property/units/${unitId}` });
    return { result: unit, audit: { action: 'unit.marketing.request', objectType: 'unit', objectId: unitId, after: { requested: true } } };
  });
}

/** Media ready: материалы готовы (возврат от Marketing) — объект можно публиковать. */
export async function markMediaReady(ctx: TenantContext, unitId: string, note?: string) {
  requirePermission(ctx, 'unit.publish');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx: Prisma.TransactionClient) => {
    const unit = await findScopedOr404(tx.unit, ctx, unitId);
    await tx.unitActivity.create({ data: { tenantId: ctx.tenantId, unitId, kind: 'NOTE', actorId: ctx.userId, note: `MARKETING_HANDOFF:media_ready${note ? ` — ${note}` : ''}` } });
    await emitDomainEvent(tx, ctx.tenantId, 'marketing.media.ready', 'unit', unitId, { unitNo: unit.unitNo, detail: 'media ready', deepLink: `/property/units/${unitId}` });
    return { result: unit, audit: { action: 'unit.marketing.ready', objectType: 'unit', objectId: unitId, after: { mediaReady: true } } };
  });
}

export interface ListingStatus {
  unitId: string;
  published: boolean;
  daysOnMarket: number | null;
  lastActivityAt: Date | null;
  stale: boolean;
  mediaRequested: boolean;
  mediaReady: boolean;
  priceHistory: { at: Date; note: string }[];
}

/** Статус листинга: days on market, stale (нет активности > stale_days), media, история цены. */
export async function getListingStatus(ctx: TenantContext, unitId: string, now = new Date()): Promise<ListingStatus> {
  requirePermission(ctx, 'property.view');
  const unit = await findScopedOr404(prisma.unit, ctx, unitId);
  const acts = await prisma.unitActivity.findMany({ where: { tenantId: ctx.tenantId, unitId }, orderBy: { happenedAt: 'desc' }, take: 100 });
  const thresholds = await getTowerThresholds(ctx.tenantId);
  const fromDate = unit.publishedAt ?? unit.vacantSince ?? null;
  const daysOnMarket = fromDate ? Math.floor((now.getTime() - new Date(fromDate).getTime()) / 86_400_000) : null;
  const lastActivityAt = acts[0]?.happenedAt ?? null;
  const staleDays = thresholds.staleDays;
  const stale = !!unit.publishedAt && (lastActivityAt ? (now.getTime() - new Date(lastActivityAt).getTime()) / 86_400_000 > staleDays : true);
  return {
    unitId,
    published: !!unit.publishedAt,
    daysOnMarket,
    lastActivityAt,
    stale,
    mediaRequested: acts.some((a) => a.note.startsWith('MARKETING_HANDOFF:requested')),
    mediaReady: acts.some((a) => a.note.startsWith('MARKETING_HANDOFF:media_ready')),
    priceHistory: acts.filter((a) => a.note.startsWith('PRICE:')).map((a) => ({ at: a.happenedAt, note: a.note })),
  };
}
