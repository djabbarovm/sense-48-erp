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

// ── Бизнес-модель Services v1.0 (P-20): условия по направлениям, каналы, cost-to-serve, пакеты, referral ──

/** Коммерческие условия направления (Services §3.1): единой комиссии нет. */
export const SERVICE_TERMS = ['COMMISSION_PER_ORDER', 'REFERRAL_RECURRING', 'PACKAGE'] as const;
export type ServiceTerms = (typeof SERVICE_TERMS)[number];
/** Уровень вовлечения (Services §3.2) — влияет на cost-to-serve, не на модель выручки. */
export const SERVICE_INVOLVEMENT = ['REFERRAL', 'MANAGED'] as const;
export type ServiceInvolvement = (typeof SERVICE_INVOLVEMENT)[number];
/** Канал обращения в «одно окно» (Services §5.3). */
export const SERVICE_CHANNELS = ['PORTAL', 'TELEGRAM', 'PHONE', 'APP', 'WALK_IN', 'STAFF'] as const;
export type ServiceChannel = (typeof SERVICE_CHANNELS)[number];
/** Профили клиентов (Services §2). Арендаторы Mall — не клиенты Services (BR-P48). */
export const SERVICE_CUSTOMER_KINDS = ['OWNER', 'RESIDENT', 'STR_GUEST', 'OFFICE_TENANT'] as const;
export type ServiceCustomerKind = (typeof SERVICE_CUSTOMER_KINDS)[number];

export interface ServiceRevenueSplit3 {
  /** Оборот — метрика спроса, не выручка (Services §4). */
  gmvMinor: bigint;
  /** Вознаграждение Services: комиссия партнёра или внутренняя ставка за собственную эксплуатацию (OPEN → 0). */
  servicesRevenueMinor: bigint;
  /** Выручка исполнителя: партнёру — цена минус комиссия; Operations — цена минус внутренняя ставка. */
  executorRevenueMinor: bigint;
  executor: 'PARTNER' | 'OPERATIONS';
}

/**
 * BR-P47: трёхуровневый учёт заказа — GMV → выручка Services → выручка исполнителя.
 * Transfer pricing между Services и Operations не определён до Master Model: ownOpsFeeBp = null → 0.
 */
export function serviceRevenueSplit3(priceMinor: bigint, providerKind: ServiceProviderKind, commissionBp: number, ownOpsFeeBp: number | null): ServiceRevenueSplit3 {
  if (priceMinor < 0n) throw new ValidationError('PRICE_INVALID');
  const bp = providerKind === 'PARTNER' ? commissionBp : (ownOpsFeeBp ?? 0);
  if (bp < 0 || bp > 10_000) throw new ValidationError('COMMISSION_INVALID');
  const services = (priceMinor * BigInt(bp)) / 10_000n;
  return { gmvMinor: priceMinor, servicesRevenueMinor: services, executorRevenueMinor: priceMinor - services, executor: providerKind === 'PARTNER' ? 'PARTNER' : 'OPERATIONS' };
}

/** Скидка клиенту (напр. 5% жителям от химчистки) — выгода клиента, не выручка Services (§3.1). */
export function applyClientDiscount(listPriceMinor: bigint, clientDiscountBp: number): bigint {
  if (clientDiscountBp < 0 || clientDiscountBp > 10_000) throw new ValidationError('DISCOUNT_INVALID');
  return listPriceMinor - (listPriceMinor * BigInt(clientDiscountBp)) / 10_000n;
}

/** Cost-to-Serve (§4): время координации × стоимость часа клиентского слоя (настройка тенанта). */
export function costToServe(handlingMinutes: number, hourCostMinor: bigint): bigint {
  if (handlingMinutes < 0) throw new ValidationError('MINUTES_INVALID');
  return (hourCostMinor * BigInt(Math.round(handlingMinutes))) / 60n;
}

/** Recurring Service Package (§3.4): регулярная покупка конкретной услуги; следующий запуск по частоте в месяц. */
export function nextPackageRun(from: Date, runsPerMonth: number): Date {
  if (!Number.isInteger(runsPerMonth) || runsPerMonth < 1 || runsPerMonth > 31) throw new ValidationError('CADENCE_INVALID', 'CADENCE_INVALID: 1–31 раз в месяц');
  const intervalDays = Math.max(1, Math.round(30 / runsPerMonth));
  return new Date(from.getTime() + intervalDays * 86_400_000);
}

/** Referral-вознаграждение (§3.1, CityNet: 15% ежемесячно от фактических поступлений подключённого пользователя). */
export function referralFee(baseMinor: bigint, feeBp: number): bigint {
  if (baseMinor < 0n) throw new ValidationError('AMOUNT_INVALID');
  if (feeBp < 0 || feeBp > 10_000) throw new ValidationError('COMMISSION_INVALID');
  return (baseMinor * BigInt(feeBp)) / 10_000n;
}

export interface PartnerStatementRow { customerRef: string; baseMinor: bigint; feeBp: number | null }

/** CSV отчёта партнёра: `customerRef;base;fee%` (fee% опционален — тогда ставка направления). */
export function parsePartnerStatementCsv(content: string): PartnerStatementRow[] {
  const rows: PartnerStatementRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^(customer|клиент|ref)/i.test(t)) continue;
    const [ref = '', base = '', fee = ''] = t.split(';').map((c) => c.trim());
    if (!ref || !base) continue;
    const norm = base.replace(/[\s]/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(norm)) throw new ValidationError('STATEMENT_ROW_INVALID', `STATEMENT_ROW_INVALID: ${ref}`);
    const [int = '0', frac = ''] = norm.split('.');
    rows.push({ customerRef: ref, baseMinor: BigInt(int) * 100n + BigInt(frac.padEnd(2, '0') || '0'), feeBp: fee ? Math.round(Number(fee.replace(',', '.')) * 100) : null });
  }
  return rows;
}
