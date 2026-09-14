/** PaymentRequest state machine (docs/04) + типы controls (C-01). */
import { ValidationError } from '../errors/index.js';
import { StateMachine } from './stateMachine.js';

export const PAYMENT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'DOCS_CHECK',
  'ON_HOLD',
  'READY_FOR_BATCH',
  'IN_BATCH',
  'APPROVED',
  'REJECTED',
  'SENT_TO_BANK',
  'PAID',
  'FAILED',
  'RECONCILED',
  'CLOSED',
  'CANCELLED',
  'DISPUTED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type ControlCode =
  | 'NO_SOURCE'
  | 'DUP_PAYMENT_SUSPECT'
  | 'OVER_OUTSTANDING'
  | 'CONTRACT_LIMIT'
  | 'CONTRACT_EXPIRED'
  | 'NO_PR'
  | 'NO_CONTRACT'
  | 'NO_RECEIPT'
  | 'INVOICE_UNMATCHED'
  | 'INVOICE_DUPLICATE_SUSPECT'
  | 'UNVERIFIED_BANK'
  | 'UNBUDGETED'
  | 'SOD_VIOLATION'
  | 'RELATED_PARTY'
  | 'NEW_VENDOR'
  | 'BANK_CHANGED_RECENTLY'
  | 'BACKDATED'
  | `MISSING_DOC:${string}`;

export interface ControlResult {
  code: ControlCode;
  result: 'PASS' | 'WARN' | 'FAIL';
  detail?: string;
}

/** BR-050: READY только если нет FAIL, либо каждый FAIL закрыт approved exception. */
export function controlsSatisfied(
  controls: ControlResult[],
  approvedException?: { type: string } | null,
): boolean {
  const fails = controls.filter((c) => c.result === 'FAIL');
  if (fails.length === 0) return true;
  if (!approvedException) return false;
  // exception закрывает FAIL своего типа; MISSING_DOC/NO_RECEIPT закрывает NO_RECEIPT-исключение и т.п.
  const coveredBy: Record<string, (code: string) => boolean> = {
    OVER_OUTSTANDING: (code) => code === 'OVER_OUTSTANDING',
    NO_CONTRACT: (code) => code === 'NO_CONTRACT',
    NO_RECEIPT: (code) => code === 'NO_RECEIPT',
    UNVERIFIED_BANK: (code) => code === 'UNVERIFIED_BANK',
    UNBUDGETED: (code) => code === 'UNBUDGETED',
  };
  const covers = coveredBy[approvedException.type];
  if (!covers) return false;
  return fails.every((f) => covers(f.code));
}

export interface PaymentPayload {
  controls?: ControlResult[];
  hasApprovedException?: boolean;
  batchOpen?: boolean;
  batchFrozen?: boolean;
  comment?: string;
  isCreator?: boolean;
  isLead?: boolean;
}

export type PaymentTrigger =
  | 'submit'
  | 'docs_check'
  | 'ready'
  | 'hold'
  | 'resolve'
  | 'add_to_batch'
  | 'remove_from_batch'
  | 'approve'
  | 'reject_item'
  | 'mark_sent'
  | 'confirm_paid'
  | 'bank_reject'
  | 'recreate'
  | 'reconcile'
  | 'close'
  | 'cancel'
  | 'dispute';

export const paymentMachine = new StateMachine<PaymentStatus, PaymentTrigger, PaymentPayload>('payment_request', {
  submit: { from: ['DRAFT'], to: 'SUBMITTED', permission: 'payment.create' },
  docs_check: { from: ['SUBMITTED'], to: 'DOCS_CHECK' }, // авто
  ready: {
    from: ['DOCS_CHECK'],
    to: 'READY_FOR_BATCH',
    guard: ({ payload }) => {
      if (!payload.controls) throw new ValidationError('CONTROLS_MISSING');
    },
  },
  hold: { from: ['DOCS_CHECK'], to: 'ON_HOLD' }, // авто при FAIL без exception
  resolve: { from: ['ON_HOLD'], to: 'DOCS_CHECK' },
  add_to_batch: {
    from: ['READY_FOR_BATCH'],
    to: 'IN_BATCH',
    permission: 'batch.edit',
    guard: ({ payload }) => {
      if (!payload.batchOpen) throw new ValidationError('BATCH_NOT_OPEN');
    },
  },
  remove_from_batch: {
    from: ['IN_BATCH'],
    to: 'READY_FOR_BATCH',
    permission: 'batch.edit',
    guard: ({ payload }) => {
      if (payload.batchFrozen) throw new ValidationError('BATCH_FROZEN', 'Состав FROZEN batch неизменен (BR-052)');
    },
  },
  approve: { from: ['IN_BATCH'], to: 'APPROVED' }, // через batch approve, BR-040 проверяется там
  reject_item: {
    from: ['IN_BATCH'],
    to: 'REJECTED',
    guard: ({ payload }) => {
      if (!payload.comment || payload.comment.trim().length === 0) {
        throw new ValidationError('REJECT_COMMENT_REQUIRED', 'Reject требует комментарий (BR-045)');
      }
    },
  },
  mark_sent: { from: ['APPROVED'], to: 'SENT_TO_BANK', permission: 'batch.mark_sent' },
  confirm_paid: { from: ['SENT_TO_BANK'], to: 'PAID' }, // ТОЛЬКО из reconciliation (BR-054)
  bank_reject: { from: ['SENT_TO_BANK'], to: 'FAILED', permission: 'bank.reconcile.manual' },
  recreate: { from: ['FAILED'], to: 'DRAFT', permission: 'payment.create' },
  reconcile: { from: ['PAID'], to: 'RECONCILED' }, // авто
  close: { from: ['RECONCILED'], to: 'CLOSED' },
  cancel: {
    from: ['DRAFT', 'SUBMITTED', 'DOCS_CHECK', 'ON_HOLD', 'READY_FOR_BATCH'],
    to: 'CANCELLED',
    guard: ({ payload }) => {
      if (!payload.isCreator && !payload.isLead) throw new ValidationError('CANCEL_FORBIDDEN');
    },
  },
  dispute: {
    from: ['DRAFT', 'SUBMITTED', 'DOCS_CHECK', 'ON_HOLD', 'READY_FOR_BATCH', 'IN_BATCH', 'APPROVED'],
    to: 'DISPUTED',
    guard: ({ payload }) => {
      if (!payload.isLead) throw new ValidationError('LEAD_ONLY');
      if (!payload.comment) throw new ValidationError('REASON_REQUIRED');
    },
  },
});
