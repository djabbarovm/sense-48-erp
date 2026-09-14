/** Contract state machine (docs/04). */
import { ValidationError } from '../errors/index.js';
import { hasRole } from '../context/index.js';
import { StateMachine } from './stateMachine.js';

export const CONTRACT_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'SIGNED',
  'REGISTERED',
  'ACTIVE',
  'AMENDING',
  'EXPIRING',
  'EXPIRED',
  'TERMINATING',
  'CLOSED',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export interface ContractPayload {
  registrationRequired: boolean;
  outstandingMinor?: bigint;
  openTasks?: number;
}

export type ContractTrigger =
  | 'submit_review'
  | 'approve'
  | 'sign'
  | 'register'
  | 'activate'
  | 'start_amend'
  | 'amendment_signed'
  | 'mark_expiring'
  | 'renew'
  | 'expire'
  | 'terminate'
  | 'close';

export const contractMachine = new StateMachine<ContractStatus, ContractTrigger, ContractPayload>('contract', {
  submit_review: { from: ['DRAFT'], to: 'IN_REVIEW', permission: 'contract.edit' },
  approve: { from: ['IN_REVIEW'], to: 'APPROVED', permission: 'contract.approve' },
  sign: { from: ['APPROVED'], to: 'SIGNED', permission: 'contract.edit' },
  register: {
    from: ['SIGNED'],
    to: 'REGISTERED',
    permission: 'contract.edit',
    guard: ({ payload }) => {
      if (!payload.registrationRequired) throw new ValidationError('REGISTRATION_NOT_REQUIRED');
    },
  },
  activate: {
    from: ['SIGNED', 'REGISTERED'],
    to: 'ACTIVE',
    permission: 'contract.edit',
    guard: ({ from, payload }) => {
      if (from === 'SIGNED' && payload.registrationRequired) {
        throw new ValidationError('REGISTRATION_REQUIRED', 'Договор требует регистрации (E-ijara) до активации');
      }
    },
  },
  start_amend: { from: ['ACTIVE'], to: 'AMENDING', permission: 'contract.edit' },
  amendment_signed: { from: ['AMENDING'], to: 'ACTIVE', permission: 'contract.edit' },
  mark_expiring: { from: ['ACTIVE'], to: 'EXPIRING' }, // авто (job)
  renew: {
    from: ['EXPIRING'],
    to: 'ACTIVE',
    permission: 'contract.approve',
    guard: ({ ctx }) => {
      if (ctx && !hasRole(ctx, 'OWNER')) throw new ValidationError('OWNER_ONLY', 'Продление — Owner (docs/04)');
    },
  },
  expire: { from: ['EXPIRING', 'ACTIVE'], to: 'EXPIRED' }, // авто
  terminate: { from: ['ACTIVE', 'EXPIRED'], to: 'TERMINATING', permission: 'contract.terminate' },
  close: {
    from: ['TERMINATING'],
    to: 'CLOSED',
    guard: ({ payload }) => {
      if ((payload.outstandingMinor ?? 0n) !== 0n) {
        throw new ValidationError('OUTSTANDING_NOT_ZERO', 'Закрытие только при outstanding = 0');
      }
      if ((payload.openTasks ?? 0) > 0) {
        throw new ValidationError('OPEN_TASKS_EXIST', 'Есть открытые задачи по договору');
      }
    },
  },
});
