/**
 * Геймификация (этап DMS) — вычисление состояния из бизнес-фактов, без параллельного мира (ТЗ §20).
 *
 * XP/уровень/streak/миссии выводятся из активностей (UnitActivity, actorId) и сделок (Deal, managerId)
 * ТЕКУЩЕГО пользователя в ЕГО тенанте — tenant/role isolation по построению. XP идемпотентен: каждая
 * активность/сделка учитывается один раз (по факту-строке), «накликать» XP кликами нельзя (учитываются
 * только полезные виды: звонок c дневным капом, follow-up, показ, оффер, закрытие сделки).
 * Награды — единственная персистентная часть (заявки), каталог берётся из tenant.settings.rewards.
 */
import type { TenantContext } from '@finance-os/core';
import {
  XP_RULES,
  levelFor,
  missionsForRole,
  STREAK_MIN_XP,
  ValidationError,
  requirePermission,
  type GameEvent,
  type GamificationState,
  type MissionMetric,
  type MissionProgress,
} from '@finance-os/core';
import type { RewardStatus } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const XP_WINDOW_DAYS = 180; // окно для накопительного XP/streak (провизорно, ТЗ §14)

/** Дата в зоне Ташкента (YYYY-MM-DD) для дневных бакетов. */
function dayKey(d: Date): string {
  return new Date(d.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
}
function tashkentDayStart(now: Date): Date {
  const key = dayKey(now);
  return new Date(`${key}T00:00:00.000+05:00`);
}

const ACTIVITY_XP: Record<string, GameEvent> = {
  CALL: 'CALL_LOGGED',
  FOLLOW_UP: 'FOLLOW_UP_DONE',
  VIEWING: 'VIEWING_SCHEDULED',
  OFFER: 'OFFER_SENT',
};

interface Fact { kind: string; at: Date; dealId: string | null }

/** XP за день из фактов этого дня, c дневными капами по типу. */
function dayXp(facts: Fact[], wonDeals: number): number {
  const perType = new Map<string, number>();
  let xp = 0;
  for (const f of facts) {
    const ev = ACTIVITY_XP[f.kind];
    if (!ev) continue;
    const rule = XP_RULES[ev];
    const used = perType.get(ev) ?? 0;
    if (rule.dailyCap !== undefined && used >= rule.dailyCap) continue;
    perType.set(ev, used + 1);
    xp += rule.xp;
  }
  xp += wonDeals * XP_RULES.DEAL_WON.xp;
  return xp;
}

function metricValue(metric: MissionMetric, todayFacts: Fact[]): number {
  const distinctDeals = (pred: (f: Fact) => boolean) => new Set(todayFacts.filter((f) => f.dealId && pred(f)).map((f) => f.dealId)).size;
  switch (metric) {
    case 'followups_done': return todayFacts.filter((f) => f.kind === 'FOLLOW_UP').length;
    case 'offers_sent': return todayFacts.filter((f) => f.kind === 'OFFER').length;
    case 'viewings_conducted': return todayFacts.filter((f) => f.kind === 'VIEWING').length;
    case 'leads_handled': return distinctDeals((f) => f.kind === 'CALL' || f.kind === 'NOTE');
    case 'deals_touched': return distinctDeals(() => true);
    case 'handoffs': return distinctDeals((f) => f.kind === 'OFFER' || f.kind === 'FOLLOW_UP');
    default: return 0;
  }
}

export async function getGamificationState(ctx: TenantContext, now = new Date()): Promise<GamificationState> {
  const since = new Date(now.getTime() - XP_WINDOW_DAYS * 86_400_000);
  const [acts, wonAll, wonWindow] = await Promise.all([
    prisma.unitActivity.findMany({
      where: { tenantId: ctx.tenantId, actorId: ctx.userId, happenedAt: { gte: since, lte: now } },
      select: { kind: true, happenedAt: true, dealId: true },
      orderBy: { happenedAt: 'desc' },
    }),
    prisma.deal.findMany({ where: { tenantId: ctx.tenantId, managerId: ctx.userId, stage: 'WON' }, select: { id: true, stageChangedAt: true } }),
    Promise.resolve(null),
  ]);
  void wonWindow;
  const facts: Fact[] = acts.map((a) => ({ kind: a.kind, at: a.happenedAt, dealId: a.dealId }));

  // Бакеты по дням (Ташкент)
  const byDay = new Map<string, Fact[]>();
  for (const f of facts) {
    const k = dayKey(f.at);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(f);
  }
  const wonByDay = new Map<string, number>();
  for (const d of wonAll) if (d.stageChangedAt >= since) wonByDay.set(dayKey(d.stageChangedAt), (wonByDay.get(dayKey(d.stageChangedAt)) ?? 0) + 1);

  // Накопительный XP по окну
  let totalXp = 0;
  for (const [k, dayFacts] of byDay) totalXp += dayXp(dayFacts, wonByDay.get(k) ?? 0);
  for (const [k, n] of wonByDay) if (!byDay.has(k)) totalXp += dayXp([], n);

  const todayKey = dayKey(now);
  const todayFacts = byDay.get(todayKey) ?? [];
  const todayXp = dayXp(todayFacts, wonByDay.get(todayKey) ?? 0);

  // Streak: подряд идущие дни c dayXp >= STREAK_MIN_XP, заканчивая сегодня или вчера
  const dayStart = tashkentDayStart(now);
  const dayDone = (offset: number): boolean => {
    const key = dayKey(new Date(dayStart.getTime() - offset * 86_400_000 + TASHKENT_OFFSET_MS));
    return dayXp(byDay.get(key) ?? [], wonByDay.get(key) ?? 0) >= STREAK_MIN_XP;
  };
  const streakDoneToday = todayXp >= STREAK_MIN_XP;
  let streakDays = 0;
  const start = streakDoneToday ? 0 : 1; // если сегодня ещё не выполнено — считаем от вчера
  for (let i = start; i < XP_WINDOW_DAYS; i++) { if (dayDone(i)) streakDays++; else break; }

  // Миссии роли — прогресс за сегодня
  const missions: MissionProgress[] = missionsForRole(ctx.roles).map((m) => {
    const done = metricValue(m.metric, todayFacts);
    return { ...m, done, complete: done >= m.target };
  });

  return {
    totalXp,
    todayXp,
    level: levelFor(totalXp),
    streakDays,
    streakDoneToday,
    missions,
    missionsComplete: missions.filter((m) => m.complete).length,
  };
}

// ── Награды (ТЗ §18) ──

export interface RewardItem { key: string; name: string; costXp: number; available: boolean }

/** Каталог по умолчанию — перекрывается tenant.settings.rewards (конфигурируемо). */
export const DEFAULT_REWARDS: RewardItem[] = [
  { key: 'sense48', name: 'Sense48: посещение SPA', costXp: 1500, available: true },
  { key: 'cinema', name: 'Билеты в кино', costXp: 800, available: true },
  { key: 'restaurant', name: 'Ужин в ресторане', costXp: 2500, available: true },
  { key: 'halfday', name: 'Полдня отгула', costXp: 4000, available: true },
  { key: 'bonus', name: 'Внутренний бонус', costXp: 6000, available: true },
];

export async function listRewards(ctx: TenantContext): Promise<RewardItem[]> {
  const t = await prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });
  const cfg = ((t?.settings as Record<string, unknown> | null)?.rewards ?? null) as RewardItem[] | null;
  const list = Array.isArray(cfg) && cfg.length ? cfg : DEFAULT_REWARDS;
  return list.filter((r) => r.available !== false).map((r) => ({ key: String(r.key), name: String(r.name), costXp: Number(r.costXp) || 0, available: true }));
}

/** Заявка на награду: нужен накопленный XP >= стоимости; создаётся запись REQUESTED (HR-флоу — позже). */
export async function requestReward(ctx: TenantContext, rewardKey: string, now = new Date()) {
  const [rewards, state] = await Promise.all([listRewards(ctx), getGamificationState(ctx, now)]);
  const reward = rewards.find((r) => r.key === rewardKey);
  if (!reward) throw new ValidationError('REWARD_NOT_FOUND');
  if (state.totalXp < reward.costXp) throw new ValidationError('NOT_ENOUGH_XP');
  const open = await prisma.rewardRedemption.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId, rewardKey, status: { in: ['REQUESTED', 'APPROVED'] } }, select: { id: true } });
  if (open) throw new ValidationError('REWARD_ALREADY_REQUESTED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const r = await tx.rewardRedemption.create({ data: { tenantId: ctx.tenantId, userId: ctx.userId, rewardKey, rewardName: reward.name, costXp: reward.costXp } });
    return { result: r, audit: { action: 'reward.request', objectType: 'reward_redemption', objectId: r.id, after: { rewardKey, costXp: reward.costXp } } };
  });
}

export async function listMyRedemptions(ctx: TenantContext) {
  return prisma.rewardRedemption.findMany({ where: { tenantId: ctx.tenantId, userId: ctx.userId }, orderBy: { createdAt: 'desc' }, take: 20 });
}

/** Решение по заявке (owner/admin). Право — user.manage (управление людьми). */
export async function decideRedemption(ctx: TenantContext, id: string, status: 'APPROVED' | 'FULFILLED' | 'DECLINED') {
  requirePermission(ctx, 'user.manage');
  const r = await prisma.rewardRedemption.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!r) throw new ValidationError('REWARD_NOT_FOUND');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const upd = await tx.rewardRedemption.update({ where: { id: r.id }, data: { status: status as RewardStatus, decidedById: ctx.userId } });
    return { result: upd, audit: { action: 'reward.decide', objectType: 'reward_redemption', objectId: r.id, before: { status: r.status }, after: { status } } };
  });
}
