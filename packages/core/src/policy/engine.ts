/**
 * B-05: policy engine (BR-041). Чистая функция: по политике (D-12) и предмету
 * согласования возвращает tier и список требуемых approvals. Вычисляется один
 * раз при submit и сохраняется — смена политики не влияет на уже поданные (BR-041).
 */

export interface PolicyConfig {
  tier1MaxMinor: bigint; // D-12: 5 000 000 UZS
  tier2MaxMinor: bigint; // 25 000 000 UZS
  unbudgetedRequiresOwner: boolean;
  newVendorOwnerThresholdMinor: bigint; // BR-035
}

export type ApprovalRoleSlot = 'BUSINESS_OWNER' | 'FINANCE' | 'OWNER';

export interface RequiredApproval {
  role: ApprovalRoleSlot;
  reason: string;
}

export interface ApprovalSubject {
  totalMinor: bigint; // в базовой валюте
  budgetStatus: 'WITHIN' | 'OVER' | 'UNBUDGETED';
  /** BR-036 */
  relatedParty?: boolean;
  /** BR-035: vendor с флагом NEW (< 90 дней) и это первый платёж */
  newVendorFirstPayment?: boolean;
  /** BR-033: дней с последней смены реквизитов (null/undefined — не менялись) */
  bankChangedDaysAgo?: number | null;
  /** fast lane (PR внутри бюджета события) — approvals не требуются, guard'ы вне engine */
  isFastLane?: boolean;
}

export interface PolicyDecision {
  tier: 1 | 2 | 3;
  approvals: RequiredApproval[];
  requiresVarianceReason: boolean;
  fastLane: boolean;
  reasons: string[];
}

export function computeTier(policy: PolicyConfig, subject: ApprovalSubject): 1 | 2 | 3 {
  if (subject.budgetStatus === 'UNBUDGETED') return 3; // D-12: unbudgeted → Tier 3
  if (subject.totalMinor > policy.tier2MaxMinor) return 3;
  if (subject.totalMinor > policy.tier1MaxMinor) return 2;
  return 1;
}

export function computeRequiredApprovals(policy: PolicyConfig, subject: ApprovalSubject): PolicyDecision {
  if (subject.isFastLane) {
    return { tier: 1, approvals: [], requiresVarianceReason: false, fastLane: true, reasons: ['FAST_LANE'] };
  }

  const tier = computeTier(policy, subject);
  const approvals: RequiredApproval[] = [];
  const reasons: string[] = [`TIER_${tier}`];
  let ownerNeeded = false;
  const ownerReasons: string[] = [];

  // D-12 базовая лестница
  approvals.push({ role: 'BUSINESS_OWNER', reason: `TIER_${tier}` });
  approvals.push({ role: 'FINANCE', reason: `TIER_${tier}` });
  if (tier >= 2) {
    ownerNeeded = true;
    ownerReasons.push(`TIER_${tier}`);
  }

  // BR-014: OVER budget → Owner на любой сумме
  if (subject.budgetStatus === 'OVER') {
    ownerNeeded = true;
    ownerReasons.push('BUDGET_OVER');
    reasons.push('BUDGET_OVER');
  }
  if (subject.budgetStatus === 'UNBUDGETED' && policy.unbudgetedRequiresOwner) {
    ownerNeeded = true;
    ownerReasons.push('UNBUDGETED');
    reasons.push('UNBUDGETED');
  }

  // BR-035: первый платёж новому vendor выше порога
  if (subject.newVendorFirstPayment && subject.totalMinor > policy.newVendorOwnerThresholdMinor) {
    ownerNeeded = true;
    ownerReasons.push('NEW_VENDOR');
    reasons.push('NEW_VENDOR');
  }

  // BR-036: related party → Owner всегда
  if (subject.relatedParty) {
    ownerNeeded = true;
    ownerReasons.push('RELATED_PARTY');
    reasons.push('RELATED_PARTY');
  }

  // BR-033: реквизиты менялись < 7 дней и сумма > tier1Max → Owner даже в Tier 1
  if (
    subject.bankChangedDaysAgo != null &&
    subject.bankChangedDaysAgo < 7 &&
    subject.totalMinor > policy.tier1MaxMinor
  ) {
    ownerNeeded = true;
    ownerReasons.push('BANK_CHANGED_RECENTLY');
    reasons.push('BANK_CHANGED_RECENTLY');
  }

  if (ownerNeeded) {
    approvals.push({ role: 'OWNER', reason: ownerReasons.join('+') });
  }

  return {
    tier,
    approvals,
    // D-12: Tier 3 требует variance_reason
    requiresVarianceReason: tier === 3,
    fastLane: false,
    reasons,
  };
}
