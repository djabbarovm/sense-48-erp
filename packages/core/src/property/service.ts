/**
 * MDS Property Wave 5 — Services marketplace (blueprint §12, docs/20 §11.8).
 * Заказ услуги → партнёр или собственная эксплуатация → статус → QA → GMV / атрибуция выручки.
 * Services владеет слоем спроса и качества; собственный клининг учитывается как выручка/затраты Operations.
 */
import { StateMachine } from '../workflows/stateMachine.js';
import { ValidationError } from '../errors/index.js';

export const SERVICE_CATEGORIES = ['CLEANING', 'LAUNDRY', 'REPAIR', 'CONCIERGE', 'MOVING', 'DESIGN', 'IT', 'OTHER'] as const;
export const SERVICE_PROVIDER_KINDS = ['OWN_OPS', 'PARTNER'] as const;
export const SERVICE_ORDER_STATUSES = ['NEW', 'ACCEPTED', 'IN_PROGRESS', 'DONE', 'VERIFIED', 'CANCELLED'] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];
export type ServiceProviderKind = (typeof SERVICE_PROVIDER_KINDS)[number];
export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];
export const OPEN_SERVICE_ORDER_STATUSES: readonly ServiceOrderStatus[] = ['NEW', 'ACCEPTED', 'IN_PROGRESS'];
/** Заказы, попадающие в GMV/выручку (BR-P36): выполненные и принятые. */
export const REVENUE_SERVICE_ORDER_STATUSES: readonly ServiceOrderStatus[] = ['DONE', 'VERIFIED'];

export type ServiceOrderTrigger = 'accept' | 'start' | 'done' | 'verify' | 'reopen' | 'cancel';

export interface ServiceOrderPayload {
  hasAssignee: boolean;
  hasProof: boolean;
  reason?: string | undefined;
  /** Исполнитель не принимает свою работу (BR-P32 распространяется на услуги). */
  actorIsAssignee: boolean;
}

export const serviceOrderMachine = new StateMachine<ServiceOrderStatus, ServiceOrderTrigger, ServiceOrderPayload>('service_order', {
  accept: { from: ['NEW'], to: 'ACCEPTED', permission: 'service.manage' },
  start: { from: ['ACCEPTED', 'NEW'], to: 'IN_PROGRESS', permission: 'service.manage' },
  done: { from: ['IN_PROGRESS', 'ACCEPTED'], to: 'DONE', permission: 'service.manage' },
  verify: {
    from: ['DONE'],
    to: 'VERIFIED',
    permission: 'service.verify',
    guard: ({ payload }) => {
      if (payload.actorIsAssignee) throw new ValidationError('QA_SELF_VERIFY', 'QA_SELF_VERIFY: исполнитель не принимает свою работу');
      if (!payload.hasProof) throw new ValidationError('PROOF_REQUIRED', 'PROOF_REQUIRED: нужно подтверждение выполнения (фото/акт)');
    },
  },
  reopen: { from: ['DONE', 'VERIFIED'], to: 'IN_PROGRESS', permission: 'service.verify', guard: ({ payload }) => { if (!payload.reason?.trim()) throw new ValidationError('REASON_REQUIRED'); } },
  cancel: { from: ['NEW', 'ACCEPTED', 'IN_PROGRESS'], to: 'CANCELLED', permission: 'service.manage', guard: ({ payload }) => { if (!payload.reason?.trim()) throw new ValidationError('REASON_REQUIRED'); } },
});

export interface ServiceRevenueSplit {
  /** Оборот заказа (что заплатил клиент). */
  gmvMinor: bigint;
  /** Выручка платформы: PARTNER → комиссия; OWN_OPS → вся сумма (Operations revenue). */
  platformRevenueMinor: bigint;
  /** Доля партнёра (0 для собственной эксплуатации). */
  partnerPayoutMinor: bigint;
}

/** BR-P36: атрибуция выручки по виду исполнителя; комиссия в базисных пунктах (10000 = 100%). */
export function serviceRevenueSplit(priceMinor: bigint, providerKind: ServiceProviderKind, commissionBp: number): ServiceRevenueSplit {
  if (priceMinor < 0n) throw new ValidationError('PRICE_INVALID');
  if (commissionBp < 0 || commissionBp > 10_000) throw new ValidationError('COMMISSION_INVALID');
  if (providerKind === 'OWN_OPS') return { gmvMinor: priceMinor, platformRevenueMinor: priceMinor, partnerPayoutMinor: 0n };
  const commission = (priceMinor * BigInt(commissionBp)) / 10_000n;
  return { gmvMinor: priceMinor, platformRevenueMinor: commission, partnerPayoutMinor: priceMinor - commission };
}

/** Заказ считается просроченным, если открыт и прошёл срок (scheduledAt + SLA). */
export function isServiceOrderOverdue(o: { status: ServiceOrderStatus; dueAt: Date }, now: Date): boolean {
  return OPEN_SERVICE_ORDER_STATUSES.includes(o.status) && o.dueAt < now;
}

/** SLA партнёра/эксплуатации: доля закрытых заказов, выполненных в срок (doneAt ≤ dueAt); null — нет данных. */
export function slaCompliance(orders: { status: ServiceOrderStatus; dueAt: Date; doneAt: Date | null }[]): number | null {
  const closed = orders.filter((o) => REVENUE_SERVICE_ORDER_STATUSES.includes(o.status) && o.doneAt);
  if (closed.length === 0) return null;
  const onTime = closed.filter((o) => o.doneAt!.getTime() <= o.dueAt.getTime()).length;
  return Math.round((onTime / closed.length) * 1000) / 10;
}

export function validateRating(rating: number): number {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ValidationError('RATING_INVALID', 'RATING_INVALID: оценка 1–5');
  return rating;
}
