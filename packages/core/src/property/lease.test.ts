import { describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext, type RoleCode } from '../context/index.js';
import { leaseMachine, unitPatchFromLease } from './lease.js';

const ctx = (...roles: RoleCode[]) => unsafeCreateTenantContext({ tenantId: 't', tenantSlug: 't', userId: 'u', roles });
const p = { unitReady: true, otherActiveOnUnit: false, startAt: new Date('2026-10-01'), endAt: new Date('2027-09-30') };

describe('Договор аренды — state machine (docs/20 §11.1)', () => {
  it('один активный на юнит; даты; расторжение c причиной; expiring — системный переход', () => {
    expect(leaseMachine.assert(ctx('COMMERCIAL_MANAGER'), 'DRAFT', 'activate', p)).toBe('ACTIVE');
    expect(() => leaseMachine.assert(ctx('COMMERCIAL_MANAGER'), 'DRAFT', 'activate', { ...p, otherActiveOnUnit: true })).toThrow(/LEASE_ALREADY_ACTIVE/);
    expect(() => leaseMachine.assert(ctx('COMMERCIAL_MANAGER'), 'DRAFT', 'activate', { ...p, endAt: new Date('2026-09-01') })).toThrow(/LEASE_DATES_INVALID/);
    expect(() => leaseMachine.assert(ctx('COMMERCIAL_MANAGER'), 'ACTIVE', 'terminate', p)).toThrow(/TERMINATE_REASON_REQUIRED/);
    expect(leaseMachine.assert(ctx('COMMERCIAL_MANAGER'), 'ACTIVE', 'terminate', { ...p, reason: 'выезд' })).toBe('TERMINATED');
    expect(leaseMachine.assert(null, 'ACTIVE', 'mark_expiring', p)).toBe('EXPIRING');
    // ADR-041 (Tower SPEC §2.2/§3.1): BROKER владеет договором и активирует lease
    expect(leaseMachine.can(ctx('BROKER'), 'DRAFT', 'activate', p)).toBe(true);
    // роль вне коммерции договор не активирует
    expect(leaseMachine.can(ctx('ACCOUNTANT'), 'DRAFT', 'activate', p)).toBe(false);
  });
  it('юнит — зеркало договора', () => {
    const active = unitPatchFromLease({ type: 'LTR', status: 'ACTIVE', occupantName: 'CityNet', endAt: new Date('2027-01-01'), rentMinor: 100n });
    expect(active).toMatchObject({ occupancy: 'OCCUPIED', rentalMode: 'LTR', leaseStatus: 'ACTIVE', occupantName: 'CityNet', monthlyRentMinor: 100n });
    expect(unitPatchFromLease({ type: 'OWNER_USE', status: 'ACTIVE', occupantName: 'x', endAt: null, rentMinor: 0n })).toMatchObject({ occupancy: 'OWNER_USE', rentalMode: 'NONE', occupantName: null, monthlyRentMinor: null });
    expect(unitPatchFromLease({ type: 'STR', status: 'TERMINATED', occupantName: 'x', endAt: null, rentMinor: 1n })).toMatchObject({ occupancy: 'VACANT', rentalMode: 'NONE', leaseStatus: 'TERMINATED', occupantName: null });
  });
});
