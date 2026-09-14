/** PurchaseRequest state machine (docs/04). */
import { ValidationError } from '../errors/index.js';
import { StateMachine } from './stateMachine.js';

export const PR_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'ORDERED',
  'RECEIVED',
  'INVOICED',
  'PAID',
  'CLOSED',
  'CANCELLED',
] as const;
export type PrStatus = (typeof PR_STATUSES)[number];

export interface PrPayload {
  isRequester?: boolean;
  isFinance?: boolean;
  allApprovalsApproved?: boolean;
  comment?: string;
}

export type PrTrigger =
  | 'submit'
  | 'approve_complete'
  | 'reject'
  | 'return_for_edit'
  | 'fast_lane'
  | 'create_po'
  | 'receipt_full'
  | 'link_invoice'
  | 'mark_paid'
  | 'close'
  | 'cancel';

export const prMachine = new StateMachine<PrStatus, PrTrigger, PrPayload>('purchase_request', {
  submit: { from: ['DRAFT'], to: 'SUBMITTED', permission: 'pr.create' },
  // approve_complete — системный переход, когда все required approvals = APPROVED
  approve_complete: {
    from: ['SUBMITTED'],
    to: 'APPROVED',
    guard: ({ payload }) => {
      if (!payload.allApprovalsApproved) throw new ValidationError('APPROVALS_INCOMPLETE');
    },
  },
  reject: {
    from: ['SUBMITTED'],
    to: 'REJECTED',
    guard: ({ payload }) => {
      // BR-045: reject требует комментарий ≥ 10 символов
      if (!payload.comment || payload.comment.trim().length < 10) {
        throw new ValidationError('REJECT_COMMENT_REQUIRED', 'Комментарий при отклонении — минимум 10 символов (BR-045)');
      }
    },
  },
  return_for_edit: { from: ['SUBMITTED'], to: 'DRAFT', permission: 'pr.approve.finance' },
  fast_lane: { from: ['DRAFT'], to: 'APPROVED' }, // системный, guard'ы в сервисе (docs/04)
  create_po: { from: ['APPROVED'], to: 'ORDERED', permission: 'po.manage' },
  receipt_full: { from: ['APPROVED', 'ORDERED'], to: 'RECEIVED', permission: 'receipt.create' },
  link_invoice: { from: ['APPROVED', 'ORDERED', 'RECEIVED'], to: 'INVOICED', permission: 'invoice.match' },
  mark_paid: { from: ['INVOICED'], to: 'PAID' }, // авто: все PaymentRequest PAID
  close: { from: ['PAID'], to: 'CLOSED' }, // авто: closing docs RECEIVED
  cancel: {
    from: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'RECEIVED', 'INVOICED'],
    to: 'CANCELLED',
    guard: ({ payload, from }) => {
      // docs/04: REQUESTER — до APPROVED; FINANCE — после
      const beforeApproval = from === 'DRAFT' || from === 'SUBMITTED' || from === 'REJECTED';
      if (beforeApproval && !payload.isRequester && !payload.isFinance) {
        throw new ValidationError('CANCEL_FORBIDDEN');
      }
      if (!beforeApproval && !payload.isFinance) {
        throw new ValidationError('CANCEL_FINANCE_ONLY', 'После утверждения отменяет только финансовая роль');
      }
      if (!payload.comment || payload.comment.trim().length === 0) {
        throw new ValidationError('CANCEL_COMMENT_REQUIRED');
      }
    },
  },
});
