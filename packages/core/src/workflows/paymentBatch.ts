/** PaymentBatch state machine (docs/04, D-13, BR-051/052/053/057). */
import { ValidationError } from '../errors/index.js';
import { StateMachine } from './stateMachine.js';

export const BATCH_STATUSES = [
  'OPEN',
  'FROZEN',
  'REVIEWED',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'EXPORTED',
  'SENT',
  'SETTLED',
  'CANCELLED',
] as const;
export type BatchStatusCore = (typeof BATCH_STATUSES)[number];

export interface BatchPayload {
  itemCount?: number;
  frozenBy?: string | null;
  reviewedBy?: string | null;
  actorId?: string;
  allItemsDecided?: boolean;
}

export type BatchTrigger =
  | 'freeze'
  | 'unfreeze'
  | 'review'
  | 'approve'
  | 'approve_partial'
  | 'export'
  | 'mark_sent'
  | 'settle'
  | 'cancel';

export const batchMachine = new StateMachine<BatchStatusCore, BatchTrigger, BatchPayload>('payment_batch', {
  freeze: {
    from: ['OPEN'],
    to: 'FROZEN',
    permission: 'batch.freeze',
    guard: ({ payload }) => {
      if (!payload.itemCount || payload.itemCount === 0) {
        throw new ValidationError('BATCH_EMPTY', 'Freeze возможен только при items > 0');
      }
    },
  },
  unfreeze: { from: ['FROZEN'], to: 'OPEN', permission: 'batch.unfreeze' },
  review: {
    from: ['FROZEN'],
    to: 'REVIEWED',
    permission: 'batch.review',
    guard: ({ ctx, payload }) => {
      // 4-eyes на уровне batch: reviewer ≠ тот, кто делал freeze (docs/04)
      if (ctx && payload.frozenBy && payload.frozenBy === ctx.userId) {
        throw new ValidationError('SOD_VIOLATION', 'Review делает не тот, кто выполнял freeze');
      }
    },
  },
  approve: {
    from: ['REVIEWED'],
    to: 'APPROVED',
    permission: 'batch.approve',
    guard: ({ payload }) => {
      if (!payload.allItemsDecided) throw new ValidationError('ITEMS_UNDECIDED');
    },
  },
  approve_partial: { from: ['REVIEWED'], to: 'PARTIALLY_APPROVED', permission: 'batch.approve' },
  export: { from: ['APPROVED', 'PARTIALLY_APPROVED'], to: 'EXPORTED', permission: 'batch.export' },
  mark_sent: { from: ['EXPORTED'], to: 'SENT', permission: 'batch.mark_sent' },
  settle: { from: ['SENT'], to: 'SETTLED' }, // авто
  cancel: { from: ['OPEN', 'FROZEN', 'REVIEWED'], to: 'CANCELLED', permission: 'batch.unfreeze' },
});
