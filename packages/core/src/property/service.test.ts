import { describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext } from '../context/index.js';
import { isServiceOrderOverdue, serviceOrderMachine, serviceRevenueSplit, slaCompliance, validateRating } from './service.js';

const ctx = (roles: Parameters<typeof unsafeCreateTenantContext>[0]['roles']) => unsafeCreateTenantContext({ tenantId: 't', tenantSlug: 't', userId: 'u', roles });
const base = { hasAssignee: true, hasProof: true, actorIsAssignee: false };

describe('BR-P36 — атрибуция выручки услуг', () => {
  it('PARTNER: GMV = цена, платформа = комиссия, партнёру остаток; OWN_OPS: вся сумма — выручка эксплуатации', () => {
    expect(serviceRevenueSplit(100_000n, 'PARTNER', 1500)).toEqual({ gmvMinor: 100_000n, platformRevenueMinor: 15_000n, partnerPayoutMinor: 85_000n });
    expect(serviceRevenueSplit(100_000n, 'OWN_OPS', 1500)).toEqual({ gmvMinor: 100_000n, platformRevenueMinor: 100_000n, partnerPayoutMinor: 0n });
    expect(() => serviceRevenueSplit(-1n, 'PARTNER', 0)).toThrow(/PRICE_INVALID/);
    expect(() => serviceRevenueSplit(1n, 'PARTNER', 10_001)).toThrow(/COMMISSION_INVALID/);
  });
});

describe('BR-P32 (услуги) — QA не исполнителем и c подтверждением', () => {
  it('NEW → ACCEPTED → IN_PROGRESS → DONE → VERIFIED; verify требует proof и другого человека', () => {
    const ops = ctx(['OPERATIONS_MANAGER']);
    expect(serviceOrderMachine.assert(ops, 'NEW', 'accept', base)).toBe('ACCEPTED');
    expect(serviceOrderMachine.assert(ops, 'ACCEPTED', 'start', base)).toBe('IN_PROGRESS');
    expect(serviceOrderMachine.assert(ops, 'IN_PROGRESS', 'done', base)).toBe('DONE');
    expect(() => serviceOrderMachine.assert(ops, 'DONE', 'verify', { ...base, hasProof: false })).toThrow(/PROOF_REQUIRED/);
    expect(() => serviceOrderMachine.assert(ops, 'DONE', 'verify', { ...base, actorIsAssignee: true })).toThrow(/QA_SELF_VERIFY/);
    expect(serviceOrderMachine.assert(ctx(['COMMERCIAL_MANAGER']), 'DONE', 'verify', base)).toBe('VERIFIED');
    expect(() => serviceOrderMachine.assert(ops, 'NEW', 'cancel', base)).toThrow(/REASON_REQUIRED/);
    expect(serviceOrderMachine.availableTriggers(ctx(['BROKER']), 'NEW', base)).toEqual([]);
    expect(serviceOrderMachine.availableTriggers(ops, 'VERIFIED', { ...base, reason: 'x' })).toEqual(['reopen']);
  });
});

describe('SLA и оценки услуг', () => {
  it('просрочка только для открытых; SLA-доля по закрытым; оценка 1–5', () => {
    const now = new Date('2026-09-19T12:00:00Z');
    expect(isServiceOrderOverdue({ status: 'NEW', dueAt: new Date('2026-09-19T11:00:00Z') }, now)).toBe(true);
    expect(isServiceOrderOverdue({ status: 'DONE', dueAt: new Date('2026-09-19T11:00:00Z') }, now)).toBe(false);
    expect(slaCompliance([])).toBeNull();
    expect(slaCompliance([
      { status: 'VERIFIED', dueAt: new Date('2026-09-10'), doneAt: new Date('2026-09-09') },
      { status: 'DONE', dueAt: new Date('2026-09-10'), doneAt: new Date('2026-09-11') },
      { status: 'CANCELLED', dueAt: new Date('2026-09-10'), doneAt: null },
    ])).toBe(50);
    expect(validateRating(5)).toBe(5);
    expect(() => validateRating(0)).toThrow(/RATING_INVALID/);
    expect(() => validateRating(4.5)).toThrow(/RATING_INVALID/);
  });
});
