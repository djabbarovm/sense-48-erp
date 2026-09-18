/**
 * MDS Property Wave 2 — договор аренды (docs/20 §11.1, ADR-018). Юнит — зеркало договора.
 */
import { StateMachine } from '../workflows/stateMachine.js';
import { ValidationError } from '../errors/index.js';
import type { LeaseStatus, OccupancyStatus, RentalMode } from './status.js';

export const LEASE_TYPES = ['LTR', 'STR', 'OWNER_USE'] as const;
export type LeaseType = (typeof LEASE_TYPES)[number];
export const LEASE_CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRING', 'TERMINATED'] as const;
export type LeaseContractStatus = (typeof LEASE_CONTRACT_STATUSES)[number];
export type LeaseTrigger = 'activate' | 'mark_expiring' | 'terminate';

export interface LeasePayload {
  unitReady: boolean;
  otherActiveOnUnit: boolean;
  startAt: Date;
  endAt: Date | null;
  reason?: string | undefined;
}

export const leaseMachine = new StateMachine<LeaseContractStatus, LeaseTrigger, LeasePayload>('lease_contract', {
  activate: {
    from: ['DRAFT'],
    to: 'ACTIVE',
    permission: 'lease.manage',
    guard: ({ payload }) => {
      if (payload.otherActiveOnUnit) throw new ValidationError('LEASE_ALREADY_ACTIVE', 'LEASE_ALREADY_ACTIVE: на юните уже есть действующий договор');
      if (payload.endAt && payload.endAt <= payload.startAt) throw new ValidationError('LEASE_DATES_INVALID');
    },
  },
  mark_expiring: { from: ['ACTIVE'], to: 'EXPIRING' },
  terminate: {
    from: ['ACTIVE', 'EXPIRING', 'DRAFT'],
    to: 'TERMINATED',
    permission: 'lease.manage',
    guard: ({ from, payload }) => {
      if (from !== 'DRAFT' && !payload.reason?.trim()) throw new ValidationError('TERMINATE_REASON_REQUIRED', 'TERMINATE_REASON_REQUIRED: укажите причину расторжения');
    },
  },
});

export interface UnitPatchFromLease {
  occupancy: OccupancyStatus;
  rentalMode: RentalMode;
  leaseStatus: LeaseStatus;
  occupantName: string | null;
  leaseEndsAt: Date | null;
  monthlyRentMinor: bigint | null;
}

/** Что проставляется на юните при активации/истечении/расторжении договора. */
export function unitPatchFromLease(lease: { type: LeaseType; status: LeaseContractStatus; occupantName: string; endAt: Date | null; rentMinor: bigint }): UnitPatchFromLease {
  if (lease.status === 'TERMINATED' || lease.status === 'DRAFT') {
    return { occupancy: 'VACANT', rentalMode: 'NONE', leaseStatus: lease.status === 'TERMINATED' ? 'TERMINATED' : 'NONE', occupantName: null, leaseEndsAt: null, monthlyRentMinor: null };
  }
  const ownerUse = lease.type === 'OWNER_USE';
  return {
    occupancy: ownerUse ? 'OWNER_USE' : 'OCCUPIED',
    rentalMode: ownerUse ? 'NONE' : (lease.type as RentalMode),
    leaseStatus: lease.status,
    occupantName: ownerUse ? null : lease.occupantName,
    leaseEndsAt: lease.endAt,
    monthlyRentMinor: ownerUse ? null : lease.rentMinor,
  };
}

export const EXPIRING_WINDOW_DAYS = 30;
