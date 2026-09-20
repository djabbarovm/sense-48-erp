import { describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext, type RoleCode } from '../context/index.js';
import { commercialStatusFromDeals, dealAttention, dealMachine, nextStage, pipelineTotals, prevStage } from './deal.js';

const ctx = (...roles: RoleCode[]) => unsafeCreateTenantContext({ tenantId: 't', tenantSlug: 't', userId: 'u', roles });
const today = new Date('2026-09-18T00:00:00Z');

describe('BR-P20 commercialStatus юнита из сделок', () => {
  it('нет активных → AVAILABLE вместо стадий сделки, иначе fallback', () => {
    expect(commercialStatusFromDeals([], 'NEGOTIATION', today)).toBe('AVAILABLE');
    expect(commercialStatusFromDeals([{ stage: 'LOST' }], 'OFF_MARKET', today)).toBe('OFF_MARKET');
  });
  it('самая продвинутая стадия; резерв побеждает показы и переговоры, но не LOI/CONTRACT', () => {
    expect(commercialStatusFromDeals([{ stage: 'VIEWING' }, { stage: 'NEW' }], 'AVAILABLE', today)).toBe('VIEWING');
    expect(commercialStatusFromDeals([{ stage: 'OFFER' }], 'AVAILABLE', today)).toBe('NEGOTIATION');
    expect(commercialStatusFromDeals([{ stage: 'VIEWING', reservedUntil: new Date('2026-09-25') }], 'AVAILABLE', today)).toBe('RESERVED');
    expect(commercialStatusFromDeals([{ stage: 'VIEWING', reservedUntil: new Date('2026-09-01') }], 'AVAILABLE', today)).toBe('VIEWING'); // резерв истёк
    expect(commercialStatusFromDeals([{ stage: 'LOI', reservedUntil: new Date('2026-09-25') }], 'AVAILABLE', today)).toBe('LOI');
    expect(commercialStatusFromDeals([{ stage: 'CONTRACT' }, { stage: 'VIEWING' }], 'AVAILABLE', today)).toBe('CONTRACTED');
  });
});

describe('BR-P11/P21/P23 воронка сделки', () => {
  it('advance идёт по одной стадии; c этапа VIEWING нужен юнит', () => {
    expect(nextStage('NEW')).toBe('QUALIFIED');
    expect(prevStage('NEW')).toBeNull();
    expect(nextStage('MOVE_IN')).toBeNull();
    expect(() => dealMachine.assert(ctx('COMMERCIAL_MANAGER'), 'PROPERTY_SELECTED', 'advance', { brokerOnly: false, hasUnit: false })).toThrow(/DEAL_UNIT_REQUIRED/);
    expect(dealMachine.assert(ctx('COMMERCIAL_MANAGER'), 'PROPERTY_SELECTED', 'advance', { brokerOnly: false, hasUnit: true })).toBe('QUALIFIED'); // формальный to, реальная цель nextStage
  });
  it('брокер полного цикла: ведёт до CONTRACT/MOVE_IN; WON только из бизнес-события (FIXED-1)', () => {
    // Азиз доводит сам договорные стадии
    expect(dealMachine.can(ctx('BROKER'), 'LOI', 'advance', { brokerOnly: true, hasUnit: true })).toBe(true); // LOI→CONTRACT
    expect(dealMachine.can(ctx('BROKER'), 'CONTRACT', 'advance', { brokerOnly: true, hasUnit: true })).toBe(true); // CONTRACT→MOVE_IN
    // из MOVE_IN «advance» уже нет (WON не ставится вручную)
    expect(() => dealMachine.assert(ctx('BROKER'), 'MOVE_IN', 'advance', { brokerOnly: true, hasUnit: true })).toThrow();
    // WON — только через win (activateLease/closeSale), брокеру теперь тоже доступно, но с договором
    expect(() => dealMachine.assert(ctx('BROKER'), 'MOVE_IN', 'win', { brokerOnly: true, hasUnit: true, hasLease: false })).toThrow(/DEAL_WIN_REQUIRES_LEASE/);
    expect(dealMachine.assert(ctx('BROKER'), 'MOVE_IN', 'win', { brokerOnly: true, hasUnit: true, hasLease: true })).toBe('WON');
    expect(dealMachine.assert(ctx('COMMERCIAL_MANAGER'), 'MOVE_IN', 'win', { brokerOnly: false, hasUnit: true, hasLease: true })).toBe('WON');
    expect(dealMachine.assert(ctx('BROKER'), 'VIEWING', 'lose', { brokerOnly: true, hasUnit: true })).toBe('LOST');
    expect(dealMachine.can(ctx('MARKETING'), 'NEW', 'advance', { brokerOnly: false, hasUnit: false })).toBe(false); // нет deal.manage
  });
});

describe('Категории выручки и внимание менеджера', () => {
  it('потенциальная / ожидаемая × вероятность / подтверждённая только CONTRACT+ c депозитом', () => {
    const t = pipelineTotals([
      { stage: 'VIEWING', expectedRateMinor: 100_000n },
      { stage: 'CONTRACT', expectedRateMinor: 200_000n, depositReceived: true },
      { stage: 'CONTRACT', budgetMinor: 50_000n, depositReceived: false },
      { stage: 'LOST', expectedRateMinor: 999_999n },
    ]);
    expect(t.active).toBe(3);
    expect(t.potentialMinor).toBe(350_000n);
    expect(t.expectedMinor).toBe(30_000n + 180_000n + 45_000n);
    expect(t.confirmedMinor).toBe(200_000n);
  });
  it('BR-P22: без следующего действия, просрочено, stale, резерв истекает', () => {
    const base = { stage: 'VIEWING' as const, stageChangedAt: new Date('2026-09-17') };
    expect(dealAttention({ ...base }, today)).toEqual(['NO_NEXT_ACTION']);
    expect(dealAttention({ ...base, nextAction: 'позвонить', nextActionAt: new Date('2026-09-10') }, today)).toEqual(['NEXT_ACTION_OVERDUE']);
    expect(dealAttention({ ...base, nextAction: 'x', nextActionAt: new Date('2026-09-20'), stageChangedAt: new Date('2026-09-01'), reservedUntil: new Date('2026-09-19') }, today)).toEqual(['STALE', 'RESERVATION_EXPIRING']);
    expect(dealAttention({ ...base, stage: 'WON' }, today)).toEqual([]);
  });
});
