import { describe, expect, it } from 'vitest';
import { computeRequiredApprovals, computeTier, type ApprovalSubject, type PolicyConfig } from './engine.js';

// D-12 стартовые пороги: Tier1 ≤ 5 млн, Tier2 ≤ 25 млн (в тийинах)
const policy: PolicyConfig = {
  tier1MaxMinor: 500_000_000n,
  tier2MaxMinor: 2_500_000_000n,
  unbudgetedRequiresOwner: true,
  newVendorOwnerThresholdMinor: 100_000_000n,
};

const base: ApprovalSubject = { totalMinor: 100_000_000n, budgetStatus: 'WITHIN' };

const roles = (d: ReturnType<typeof computeRequiredApprovals>) => d.approvals.map((a) => a.role);

describe('B-05 policy engine (BR-041, D-12)', () => {
  // table-driven: все ветки tier
  it.each([
    [100_000_000n, 'WITHIN', 1],
    [500_000_000n, 'WITHIN', 1], // ровно граница Tier1
    [500_000_001n, 'WITHIN', 2],
    [2_500_000_000n, 'WITHIN', 2],
    [2_500_000_001n, 'WITHIN', 3],
    [1n, 'UNBUDGETED', 3], // unbudgeted → Tier 3 на любой сумме
  ] as const)('tier(%s, %s) = %s', (total, budgetStatus, expected) => {
    expect(computeTier(policy, { totalMinor: total, budgetStatus })).toBe(expected);
  });

  it('Tier 1: business owner + finance, без Owner', () => {
    const d = computeRequiredApprovals(policy, base);
    expect(d.tier).toBe(1);
    expect(roles(d)).toEqual(['BUSINESS_OWNER', 'FINANCE']);
    expect(d.requiresVarianceReason).toBe(false);
  });

  it('Tier 2: + Owner', () => {
    const d = computeRequiredApprovals(policy, { ...base, totalMinor: 1_000_000_000n });
    expect(d.tier).toBe(2);
    expect(roles(d)).toEqual(['BUSINESS_OWNER', 'FINANCE', 'OWNER']);
  });

  it('Tier 3: Owner + variance_reason', () => {
    const d = computeRequiredApprovals(policy, { ...base, totalMinor: 3_000_000_000n });
    expect(d.tier).toBe(3);
    expect(d.requiresVarianceReason).toBe(true);
  });

  it('BR-014 OVER: Owner на любой сумме', () => {
    const d = computeRequiredApprovals(policy, { ...base, budgetStatus: 'OVER' });
    expect(d.tier).toBe(1);
    expect(roles(d)).toContain('OWNER');
    expect(d.reasons).toContain('BUDGET_OVER');
  });

  it('UNBUDGETED: Tier 3 + Owner (policy flag)', () => {
    const d = computeRequiredApprovals(policy, { ...base, budgetStatus: 'UNBUDGETED' });
    expect(d.tier).toBe(3);
    expect(roles(d)).toContain('OWNER');
    expect(d.reasons).toContain('UNBUDGETED');
  });

  it('BR-035: первый платёж NEW vendor выше порога → Owner; ниже порога — нет', () => {
    const above = computeRequiredApprovals(policy, { ...base, newVendorFirstPayment: true, totalMinor: 200_000_000n });
    expect(roles(above)).toContain('OWNER');
    expect(above.reasons).toContain('NEW_VENDOR');
    const below = computeRequiredApprovals(policy, { ...base, newVendorFirstPayment: true, totalMinor: 50_000_000n });
    expect(roles(below)).not.toContain('OWNER');
  });

  it('BR-036: related party → Owner всегда', () => {
    const d = computeRequiredApprovals(policy, { ...base, relatedParty: true, totalMinor: 1n });
    expect(roles(d)).toContain('OWNER');
    expect(d.reasons).toContain('RELATED_PARTY');
  });

  it('BR-033: смена реквизитов < 7 дней + сумма > tier1Max → Owner в Tier 1... (сумма выше tier1 → и так tier2, проверяем формулировку на границе)', () => {
    // сумма выше tier1Max, но report reason BANK_CHANGED присутствует
    const d = computeRequiredApprovals(policy, { ...base, totalMinor: 600_000_000n, bankChangedDaysAgo: 3 });
    expect(d.reasons).toContain('BANK_CHANGED_RECENTLY');
    expect(roles(d)).toContain('OWNER');
    // 8 дней назад — правило не срабатывает (tier 2 всё равно требует Owner)
    const old = computeRequiredApprovals(policy, { ...base, totalMinor: 600_000_000n, bankChangedDaysAgo: 8 });
    expect(old.reasons).not.toContain('BANK_CHANGED_RECENTLY');
    // маленькая сумма + свежая смена — Owner не нужен по BR-033 (requested <= tier1Max)
    const small = computeRequiredApprovals(policy, { ...base, totalMinor: 100_000_000n, bankChangedDaysAgo: 3 });
    expect(roles(small)).not.toContain('OWNER');
  });

  it('fast lane: approvals пустые', () => {
    const d = computeRequiredApprovals(policy, { ...base, isFastLane: true });
    expect(d.fastLane).toBe(true);
    expect(d.approvals).toEqual([]);
  });

  it('Owner добавляется один раз с объединённой причиной', () => {
    const d = computeRequiredApprovals(policy, {
      ...base,
      totalMinor: 3_000_000_000n,
      relatedParty: true,
      budgetStatus: 'OVER',
    });
    expect(roles(d).filter((r) => r === 'OWNER')).toHaveLength(1);
    const owner = d.approvals.find((a) => a.role === 'OWNER')!;
    expect(owner.reason).toContain('TIER_3');
    expect(owner.reason).toContain('RELATED_PARTY');
  });
});
