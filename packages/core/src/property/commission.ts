/**
 * MDS Property — комиссии ORDO по продуктам и бонусы продажников (blueprint §17; бизнес-модель Tower §2; решения владельца 19.09.2026).
 * Продукт сделки задаёт плательщика, базу и ставку комиссии ORDO (BR-P41). Комиссия начисляется только на WON;
 * PAID — только по банковской транзакции (BR-P42). Бонус: 20% комиссии за сделку + 10% за KPI-чек-лист (аренда);
 * продажа — треть комиссии (1% от суммы при 3%); STR — не решено (BR-P43). Бонус к выплате только после поступления
 * комиссии; проигрыш/расторжение до поступления → удержан (BR-P44).
 */
import { ValidationError } from '../errors/index.js';

export const DEAL_PRODUCTS = ['LEASE_LTR', 'LEASE_OFFICE', 'SALE', 'STR_MANDATE', 'PARKING_LEASE', 'PARKING_SALE', 'MALL_LEASE'] as const;
export type DealProduct = (typeof DEAL_PRODUCTS)[number];
export const LEASE_PRODUCTS: readonly DealProduct[] = ['LEASE_LTR', 'LEASE_OFFICE', 'PARKING_LEASE', 'MALL_LEASE'];
export const SALE_PRODUCTS: readonly DealProduct[] = ['SALE', 'PARKING_SALE'];

export type CommissionPayer = 'TENANT' | 'OWNER' | 'SELLER' | 'DEVELOPER';
export type CommissionBase = 'MONTH_RENT' | 'SALE_PRICE' | 'COLLECTED_RENT' | 'NONE';

export interface CommissionRule {
  payer: CommissionPayer;
  base: CommissionBase;
  /** Ставка в б.п. от базы; null — не утверждена (OPEN в бизнес-модели). */
  rateBp: number | null;
  /** Допустимый коридор ставки (продажа: 3% целевая → 2% → 1,5% минимум). */
  corridorBp?: [number, number];
  /** Регулярное вознаграждение (управление), а не разовая комиссия. */
  recurring: boolean;
}

/** ФАКТ/РЕШЕНИЕ по бизнес-модели Tower §2.1–2.2 и Mall §2; OPEN — rateBp = null. */
export const COMMISSION_RULES: Record<DealProduct, CommissionRule> = {
  LEASE_LTR: { payer: 'TENANT', base: 'MONTH_RENT', rateBp: 5000, recurring: false },
  LEASE_OFFICE: { payer: 'TENANT', base: 'MONTH_RENT', rateBp: 5000, recurring: false },
  SALE: { payer: 'SELLER', base: 'SALE_PRICE', rateBp: 300, corridorBp: [150, 300], recurring: false },
  PARKING_SALE: { payer: 'SELLER', base: 'SALE_PRICE', rateBp: 300, corridorBp: [150, 300], recurring: false },
  PARKING_LEASE: { payer: 'OWNER', base: 'MONTH_RENT', rateBp: 5000, recurring: false },
  STR_MANDATE: { payer: 'OWNER', base: 'COLLECTED_RENT', rateBp: null, recurring: true }, // fee 15/20/25% и база — гипотеза
  MALL_LEASE: { payer: 'OWNER', base: 'MONTH_RENT', rateBp: null, recurring: false }, // success fee: 50% мес / 1 мес / % годовой — OPEN
};

export interface CommissionCalc {
  payer: CommissionPayer;
  base: CommissionBase;
  baseMinor: bigint;
  rateBp: number;
  amountMinor: bigint;
}

/** BR-P41: комиссия ORDO по правилу продукта; ставка переопределяется только внутри коридора. */
export function computeCommission(product: DealProduct, baseMinor: bigint, rateBpOverride?: number | null): CommissionCalc {
  const rule = COMMISSION_RULES[product];
  if (baseMinor <= 0n) throw new ValidationError('COMMISSION_BASE_REQUIRED', 'COMMISSION_BASE_REQUIRED: нет базы для комиссии (аренда/цена продажи)');
  const rateBp = rateBpOverride ?? rule.rateBp;
  if (rateBp == null) throw new ValidationError('COMMISSION_RATE_OPEN', `COMMISSION_RATE_OPEN: ставка для ${product} не утверждена`);
  if (rateBpOverride != null) {
    const [min, max] = rule.corridorBp ?? [rule.rateBp ?? 0, rule.rateBp ?? 0];
    if (rateBpOverride < min || rateBpOverride > max) throw new ValidationError('COMMISSION_RATE_OUT_OF_CORRIDOR', `COMMISSION_RATE_OUT_OF_CORRIDOR: допустимо ${min / 100}–${max / 100}%`);
  }
  return { payer: rule.payer, base: rule.base, baseMinor, rateBp, amountMinor: (baseMinor * BigInt(rateBp)) / 10_000n };
}

// ── Бонусы ──

export const BONUS_KINDS = ['DEAL', 'KPI'] as const;
export type BonusKind = (typeof BONUS_KINDS)[number];
export const BONUS_STATUSES = ['POTENTIAL', 'CONFIRMED', 'PAYABLE', 'PAID', 'WITHHELD'] as const;
export type BonusStatus = (typeof BONUS_STATUSES)[number];

export interface BonusSettings {
  /** Аренда: доля комиссии за сделку, б.п. (20%). */
  leaseDealBp: number;
  /** Аренда: доля комиссии за KPI-чек-лист, б.п. (+10%). */
  leaseKpiBp: number;
  /** Продажа: доля комиссии (треть = 1% от суммы при 3%). */
  saleDealBp: number;
  /** Срок закрытия чек-листа после заезда, дней. */
  kpiDeadlineDays: number;
}

export const DEFAULT_BONUS_SETTINGS: BonusSettings = { leaseDealBp: 2000, leaseKpiBp: 1000, saleDealBp: 3333, kpiDeadlineDays: 14 };

export function bonusSettingsFrom(settings: Record<string, unknown> | null | undefined): BonusSettings {
  const num = (k: string, d: number) => { const v = Number(settings?.[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
  return { leaseDealBp: num('bonus_lease_deal_bp', DEFAULT_BONUS_SETTINGS.leaseDealBp), leaseKpiBp: num('bonus_lease_kpi_bp', DEFAULT_BONUS_SETTINGS.leaseKpiBp), saleDealBp: num('bonus_sale_deal_bp', DEFAULT_BONUS_SETTINGS.saleDealBp), kpiDeadlineDays: num('bonus_kpi_deadline_days', DEFAULT_BONUS_SETTINGS.kpiDeadlineDays) };
}

export interface BonusLine {
  kind: BonusKind;
  rateBp: number;
  amountMinor: bigint;
}

/** BR-P43: состав бонуса по продукту; база — чистая комиссия ORDO (после доли внешнего брокера). STR — не решено → пусто. */
export function bonusLines(product: DealProduct, netCommissionMinor: bigint, s: BonusSettings = DEFAULT_BONUS_SETTINGS): BonusLine[] {
  if (netCommissionMinor <= 0n) return [];
  if (LEASE_PRODUCTS.includes(product)) {
    return [
      { kind: 'DEAL', rateBp: s.leaseDealBp, amountMinor: (netCommissionMinor * BigInt(s.leaseDealBp)) / 10_000n },
      { kind: 'KPI', rateBp: s.leaseKpiBp, amountMinor: (netCommissionMinor * BigInt(s.leaseKpiBp)) / 10_000n },
    ];
  }
  if (SALE_PRODUCTS.includes(product)) return [{ kind: 'DEAL', rateBp: s.saleDealBp, amountMinor: (netCommissionMinor * BigInt(s.saleDealBp)) / 10_000n }];
  return []; // STR_MANDATE: схема не утверждена
}

/** KPI-чек-лист после сделки аренды (решение владельца): онбординг, ключи доступа, интернет, клининг, передача в Services. */
export const KPI_CHECKLIST_ITEMS = ['ONBOARDING', 'ACCESS_KEYS', 'INTERNET', 'CLEANING', 'HANDOVER_SERVICES'] as const;
export type KpiChecklistItem = (typeof KPI_CHECKLIST_ITEMS)[number];

export function kpiDeadline(leaseStartAt: Date, s: BonusSettings = DEFAULT_BONUS_SETTINGS): Date {
  return new Date(leaseStartAt.getTime() + s.kpiDeadlineDays * 86_400_000);
}

export interface KpiConfirmInput {
  doneItems: readonly KpiChecklistItem[];
  confirmerId: string;
  salespersonId: string;
  deadline: Date;
  now: Date;
}

/** BR-P43: KPI подтверждает не сам продажник, все пункты закрыты и срок не вышел. */
export function assertKpiConfirmable(i: KpiConfirmInput): void {
  if (i.confirmerId === i.salespersonId) throw new ValidationError('KPI_SELF_CONFIRM', 'KPI_SELF_CONFIRM: чек-лист подтверждает коммерческий менеджер, не продажник');
  const missing = KPI_CHECKLIST_ITEMS.filter((x) => !i.doneItems.includes(x));
  if (missing.length) throw new ValidationError('KPI_INCOMPLETE', `KPI_INCOMPLETE: не закрыто ${missing.join(', ')}`);
  if (i.now > i.deadline) throw new ValidationError('KPI_DEADLINE_PASSED', 'KPI_DEADLINE_PASSED: срок чек-листа истёк, бонус KPI удержан');
}

/**
 * BR-P43/P44: статус бонуса из статуса комиссии и KPI.
 * DEAL: CONFIRMED на WON → PAYABLE когда комиссия PAID. KPI: POTENTIAL до подтверждения чек-листа → CONFIRMED → PAYABLE после PAID.
 * Комиссия CANCELLED (проигрыш/расторжение до поступления) → WITHHELD. Уже PAID не меняется.
 */
export function deriveBonusStatus(i: { kind: BonusKind; current: BonusStatus; commissionStatus: 'ACCRUED' | 'PARTIAL' | 'PAID' | 'CANCELLED'; kpiConfirmed: boolean; kpiDeadlinePassed: boolean }): BonusStatus {
  if (i.current === 'PAID' || i.current === 'WITHHELD') return i.current;
  if (i.commissionStatus === 'CANCELLED') return 'WITHHELD';
  if (i.kind === 'KPI') {
    if (!i.kpiConfirmed) return i.kpiDeadlinePassed ? 'WITHHELD' : 'POTENTIAL';
    return i.commissionStatus === 'PAID' ? 'PAYABLE' : 'CONFIRMED';
  }
  return i.commissionStatus === 'PAID' ? 'PAYABLE' : 'CONFIRMED';
}
