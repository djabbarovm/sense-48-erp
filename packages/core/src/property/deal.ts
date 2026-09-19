/**
 * MDS Property Wave 2 — сделка CRM (docs/20 §11.2, ADR-018).
 * Воронка blueprint §6; вероятности стадий — для «ожидаемой» выручки CEO-контура.
 */
import { StateMachine } from '../workflows/stateMachine.js';
import { ValidationError } from '../errors/index.js';
import type { CommercialStatus } from './status.js';

export const DEAL_STAGES = ['NEW', 'QUALIFIED', 'PROPERTY_SELECTED', 'VIEWING', 'OFFER', 'NEGOTIATION', 'LOI', 'CONTRACT', 'MOVE_IN', 'WON', 'LOST'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];
export const ACTIVE_DEAL_STAGES: readonly DealStage[] = ['NEW', 'QUALIFIED', 'PROPERTY_SELECTED', 'VIEWING', 'OFFER', 'NEGOTIATION', 'LOI', 'CONTRACT', 'MOVE_IN'];
export const DEAL_SOURCES = ['WEBSITE', 'TELEGRAM', 'WHATSAPP', 'INSTAGRAM', 'REFERRAL', 'BROKER', 'WALK_IN', 'OTHER'] as const;
export const DEAL_LOST_REASONS = ['PRICE', 'TIMING', 'LOCATION', 'COMPETITOR', 'NO_RESPONSE', 'OTHER'] as const;

/** Вероятность закрытия по стадии, % (docs/20 §11.2). */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  NEW: 5, QUALIFIED: 10, PROPERTY_SELECTED: 20, VIEWING: 30, OFFER: 45, NEGOTIATION: 60, LOI: 75, CONTRACT: 90, MOVE_IN: 100, WON: 100, LOST: 0,
};

const STAGE_INDEX = Object.fromEntries(DEAL_STAGES.map((s, i) => [s, i])) as Record<DealStage, number>;
export const stageIndex = (s: DealStage) => STAGE_INDEX[s];
export const isActiveStage = (s: DealStage) => ACTIVE_DEAL_STAGES.includes(s);

/** Стадии, до которых брокер двигает сделку сам (BR-P11/P21): договорные — коммерческий менеджер. */
export const BROKER_MAX_STAGE: DealStage = 'LOI';
/** BR-P62: колл-центр ведёт сделку до показа включительно, дальше — менеджер. */
export const CALL_CENTER_MAX_STAGE: DealStage = 'VIEWING';

export type DealTrigger = 'advance' | 'back' | 'lose' | 'reopen' | 'win';

export interface DealPayload {
  brokerOnly: boolean;
  callCenterOnly?: boolean;
  target?: DealStage;
  hasUnit: boolean;
  hasLease?: boolean;
  /** Сделка продажи: WON фиксируется закрытием продажи c ценой, а не договором аренды. */
  isSale?: boolean;
  hasSalePrice?: boolean;
}

/**
 * advance/back — на одну стадию (target = соседняя), lose — из любой активной, reopen — из LOST в NEW,
 * win — только из MOVE_IN и только c активированным договором (BR-P23).
 */
export const dealMachine = new StateMachine<DealStage, DealTrigger, DealPayload>('deal', {
  advance: {
    from: [...ACTIVE_DEAL_STAGES.filter((s) => s !== 'MOVE_IN')],
    to: 'QUALIFIED', // фактическая цель — nextStage(from); to здесь формальное
    permission: 'deal.manage',
    guard: ({ from, payload }) => {
      const next = nextStage(from);
      if (!next) throw new ValidationError('DEAL_LAST_STAGE');
      if (stageIndex(next) >= stageIndex('PROPERTY_SELECTED') + 1 && !payload.hasUnit) throw new ValidationError('DEAL_UNIT_REQUIRED', 'DEAL_UNIT_REQUIRED: c этапа «Показ» у сделки должен быть выбран юнит');
      if (payload.callCenterOnly && stageIndex(next) > stageIndex(CALL_CENTER_MAX_STAGE)) throw new ValidationError('CALL_CENTER_STAGE_LIMIT', 'CALL_CENTER_STAGE_LIMIT: после показа сделку ведёт менеджер (BR-P62)');
      if (payload.brokerOnly && stageIndex(next) > stageIndex(BROKER_MAX_STAGE)) throw new ValidationError('BROKER_STAGE_LIMIT', 'BROKER_STAGE_LIMIT: договорные стадии выставляет коммерческий менеджер');
    },
  },
  back: { from: [...ACTIVE_DEAL_STAGES.filter((s) => s !== 'NEW')], to: 'NEW', permission: 'deal.manage' },
  lose: { from: [...ACTIVE_DEAL_STAGES], to: 'LOST', permission: 'deal.manage' },
  reopen: { from: ['LOST'], to: 'NEW', permission: 'deal.manage' },
  win: {
    from: ['MOVE_IN', 'CONTRACT'],
    to: 'WON',
    permission: 'deal.manage',
    guard: ({ payload }) => {
      if (payload.isSale) {
        if (!payload.hasSalePrice) throw new ValidationError('SALE_PRICE_REQUIRED', 'SALE_PRICE_REQUIRED: закрытие продажи требует цену сделки');
      } else if (!payload.hasLease) throw new ValidationError('DEAL_WIN_REQUIRES_LEASE', 'DEAL_WIN_REQUIRES_LEASE: сделка выигрывается активацией договора аренды (BR-P23)');
      if (payload.brokerOnly) throw new ValidationError('BROKER_STAGE_LIMIT');
    },
  },
});

export function nextStage(s: DealStage): DealStage | null {
  const i = stageIndex(s);
  const n = DEAL_STAGES[i + 1];
  return n && isActiveStage(n) ? n : null;
}
export function prevStage(s: DealStage): DealStage | null {
  const i = stageIndex(s);
  const p = DEAL_STAGES[i - 1];
  return p && isActiveStage(p) ? p : null;
}

export interface DealForUnit {
  stage: DealStage;
  reservedUntil?: Date | null;
}

/** BR-P20: commercialStatus юнита = самая продвинутая активная сделка; резерв побеждает показы/переговоры. */
export function commercialStatusFromDeals(deals: DealForUnit[], fallback: CommercialStatus, today: Date = new Date()): CommercialStatus {
  const active = deals.filter((d) => isActiveStage(d.stage));
  if (active.length === 0) return fallback === 'RESERVED' || fallback === 'VIEWING' || fallback === 'NEGOTIATION' || fallback === 'LOI' || fallback === 'CONTRACTED' ? 'AVAILABLE' : fallback;
  const top = active.reduce((a, b) => (stageIndex(b.stage) > stageIndex(a.stage) ? b : a));
  const reserved = active.some((d) => d.reservedUntil && d.reservedUntil >= today);
  if (top.stage === 'CONTRACT' || top.stage === 'MOVE_IN') return 'CONTRACTED';
  if (top.stage === 'LOI') return 'LOI';
  if (reserved) return 'RESERVED';
  if (top.stage === 'OFFER' || top.stage === 'NEGOTIATION') return 'NEGOTIATION';
  if (top.stage === 'VIEWING') return 'VIEWING';
  return 'AVAILABLE';
}

export interface DealMoney {
  stage: DealStage;
  expectedRateMinor?: bigint | null;
  budgetMinor?: bigint | null;
  depositReceived?: boolean;
}

export interface PipelineTotals {
  active: number;
  potentialMinor: bigint;
  expectedMinor: bigint;
  confirmedMinor: bigint;
}

/** Категории выручки CEO (docs/16 §9): потенциальная / ожидаемая × вероятность / подтверждённая (CONTRACT+ c депозитом). */
export function pipelineTotals(deals: DealMoney[]): PipelineTotals {
  const t: PipelineTotals = { active: 0, potentialMinor: 0n, expectedMinor: 0n, confirmedMinor: 0n };
  for (const d of deals) {
    if (!isActiveStage(d.stage)) continue;
    const value = d.expectedRateMinor ?? d.budgetMinor ?? 0n;
    t.active++;
    t.potentialMinor += value;
    t.expectedMinor += (value * BigInt(STAGE_PROBABILITY[d.stage])) / 100n;
    if ((d.stage === 'CONTRACT' || d.stage === 'MOVE_IN') && d.depositReceived) t.confirmedMinor += value;
  }
  return t;
}

export interface DealActivityFields {
  stage: DealStage;
  nextActionAt?: Date | null;
  nextAction?: string | null;
  stageChangedAt: Date;
  reservedUntil?: Date | null;
}

export type DealAttention = 'NO_NEXT_ACTION' | 'NEXT_ACTION_OVERDUE' | 'STALE' | 'RESERVATION_EXPIRING';

/** BR-P22: просроченная активность — фильтр «где нужен менеджер». Порог stale настраивается. */
export function dealAttention(d: DealActivityFields, today: Date = new Date(), staleDays = 7): DealAttention[] {
  if (!isActiveStage(d.stage)) return [];
  const out: DealAttention[] = [];
  if (!d.nextAction || !d.nextActionAt) out.push('NO_NEXT_ACTION');
  else if (d.nextActionAt < today) out.push('NEXT_ACTION_OVERDUE');
  if ((today.getTime() - d.stageChangedAt.getTime()) / 86_400_000 > staleDays) out.push('STALE');
  if (d.reservedUntil && (d.reservedUntil.getTime() - today.getTime()) / 86_400_000 <= 3) out.push('RESERVATION_EXPIRING');
  return out;
}
