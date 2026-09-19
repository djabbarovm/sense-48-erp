/** P-17: аналитика воронки и атрибуция (blueprint §14): источники → стадии → выигрыш/проигрыш, причины, конверсия, скорость. */
import type { TenantContext } from '@finance-os/core';
import { DEAL_STAGES, STAGE_PROBABILITY, isActiveStage, requirePermission, type DealStage } from '@finance-os/core';
import type { DealLostReason, DealSource } from '@prisma/client';
import { prisma } from '../client.js';

export interface FunnelAnalytics {
  period: { from: Date; to: Date };
  bySource: { source: DealSource; leads: number; active: number; won: number; lost: number; wonRentMinor: bigint; conversionPct: number }[];
  byStage: { stage: DealStage; count: number; potentialMinor: bigint; probability: number }[];
  lostReasons: { reason: DealLostReason; count: number; potentialMinor: bigint }[];
  velocity: { avgDaysToWon: number | null; avgDaysToLost: number | null; medianDaysInPipeline: number | null };
  totals: { leads: number; won: number; lost: number; active: number; winRatePct: number; wonRentMinor: bigint };
  utmCampaigns: { campaign: string; leads: number; won: number }[];
}

export async function getFunnelAnalytics(ctx: TenantContext, days = 90, now = new Date()): Promise<FunnelAnalytics> {
  requirePermission(ctx, 'deal.view');
  const from = new Date(now.getTime() - days * 86_400_000);
  const deals = await prisma.deal.findMany({ where: { tenantId: ctx.tenantId, createdAt: { gte: from } }, select: { source: true, stage: true, createdAt: true, stageChangedAt: true, expectedRateMinor: true, budgetMinor: true, lostReason: true, utm: true, wonLeaseId: true } });
  const value = (d: { expectedRateMinor: bigint | null; budgetMinor: bigint | null }) => d.expectedRateMinor ?? d.budgetMinor ?? 0n;
  const daysBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 86_400_000);
  const src = new Map<DealSource, FunnelAnalytics['bySource'][number]>();
  const stage = new Map<DealStage, { count: number; potentialMinor: bigint }>();
  const lost = new Map<DealLostReason, { count: number; potentialMinor: bigint }>();
  const utm = new Map<string, { leads: number; won: number }>();
  const wonDays: number[] = [];
  const lostDays: number[] = [];
  const pipelineDays: number[] = [];
  for (const d of deals) {
    const s = src.get(d.source) ?? { source: d.source, leads: 0, active: 0, won: 0, lost: 0, wonRentMinor: 0n, conversionPct: 0 };
    s.leads++;
    if (d.stage === 'WON') { s.won++; s.wonRentMinor += value(d); wonDays.push(daysBetween(d.createdAt, d.stageChangedAt)); }
    else if (d.stage === 'LOST') { s.lost++; lostDays.push(daysBetween(d.createdAt, d.stageChangedAt)); const l = lost.get(d.lostReason ?? 'OTHER') ?? { count: 0, potentialMinor: 0n }; l.count++; l.potentialMinor += value(d); lost.set(d.lostReason ?? 'OTHER', l); }
    else { s.active++; pipelineDays.push(daysBetween(d.createdAt, now)); }
    src.set(d.source, s);
    const st = stage.get(d.stage) ?? { count: 0, potentialMinor: 0n };
    st.count++; st.potentialMinor += value(d); stage.set(d.stage, st);
    const campaign = d.utm && typeof d.utm === 'object' && 'utm_campaign' in (d.utm as object) ? String((d.utm as Record<string, unknown>).utm_campaign) : null;
    if (campaign) { const c = utm.get(campaign) ?? { leads: 0, won: 0 }; c.leads++; if (d.stage === 'WON') c.won++; utm.set(campaign, c); }
  }
  for (const s of src.values()) s.conversionPct = s.leads ? Math.round((s.won / s.leads) * 100) : 0;
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]! * 10) / 10; };
  const totals = { leads: deals.length, won: deals.filter((d) => d.stage === 'WON').length, lost: deals.filter((d) => d.stage === 'LOST').length, active: deals.filter((d) => isActiveStage(d.stage)).length, winRatePct: 0, wonRentMinor: deals.filter((d) => d.stage === 'WON').reduce((s, d) => s + value(d), 0n) };
  totals.winRatePct = totals.won + totals.lost ? Math.round((totals.won / (totals.won + totals.lost)) * 100) : 0;
  return {
    period: { from, to: now },
    bySource: [...src.values()].sort((a, b) => b.leads - a.leads),
    byStage: DEAL_STAGES.map((s) => ({ stage: s, count: stage.get(s)?.count ?? 0, potentialMinor: stage.get(s)?.potentialMinor ?? 0n, probability: STAGE_PROBABILITY[s] })),
    lostReasons: [...lost.entries()].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.count - a.count),
    velocity: { avgDaysToWon: avg(wonDays), avgDaysToLost: avg(lostDays), medianDaysInPipeline: median(pipelineDays) },
    totals,
    utmCampaigns: [...utm.entries()].map(([campaign, v]) => ({ campaign, ...v })).sort((a, b) => b.leads - a.leads).slice(0, 10),
  };
}
