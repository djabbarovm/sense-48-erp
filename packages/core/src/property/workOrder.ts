/**
 * MDS Property Wave 4 — заявки и инциденты (blueprint §12, docs/20 §11.5).
 * WorkOrder — источник истины operationalStatus юнита (BR-P31): статус выводится из открытых заявок.
 */
import { StateMachine } from '../workflows/stateMachine.js';
import { ValidationError } from '../errors/index.js';
import type { OperationalStatus } from './status.js';

export const WORK_ORDER_CATEGORIES = ['PLUMBING', 'ELECTRICAL', 'HVAC', 'CLEANING', 'DAMAGE', 'ACCESS', 'OTHER'] as const;
export const WORK_ORDER_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export const WORK_ORDER_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE', 'VERIFIED', 'CANCELLED'] as const;
export type WorkOrderCategory = (typeof WORK_ORDER_CATEGORIES)[number];
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export const OPEN_WORK_ORDER_STATUSES: readonly WorkOrderStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE'];

/** SLA по приоритету, часы (blueprint §12; настраивается позже в tenant settings). */
export const SLA_HOURS: Record<WorkOrderPriority, number> = { CRITICAL: 4, HIGH: 24, NORMAL: 72, LOW: 168 };

export function slaDueAt(priority: WorkOrderPriority, createdAt: Date): Date {
  return new Date(createdAt.getTime() + SLA_HOURS[priority] * 3_600_000);
}

export type WorkOrderTrigger = 'assign' | 'start' | 'done' | 'verify' | 'reopen' | 'cancel';

export interface WorkOrderPayload {
  hasAssignee: boolean;
  hasProof: boolean;
  reason?: string | undefined;
  /** Исполнитель не может принимать свою же работу (QA — другой человек, BR-P32). */
  actorIsAssignee: boolean;
}

export const workOrderMachine = new StateMachine<WorkOrderStatus, WorkOrderTrigger, WorkOrderPayload>('work_order', {
  assign: { from: ['OPEN', 'ASSIGNED'], to: 'ASSIGNED', permission: 'workorder.manage', guard: ({ payload }) => { if (!payload.hasAssignee) throw new ValidationError('ASSIGNEE_REQUIRED'); } },
  start: { from: ['ASSIGNED', 'OPEN'], to: 'IN_PROGRESS', permission: 'workorder.manage' },
  done: { from: ['IN_PROGRESS', 'ASSIGNED'], to: 'DONE', permission: 'workorder.manage' },
  verify: {
    from: ['DONE'],
    to: 'VERIFIED',
    permission: 'workorder.verify',
    guard: ({ payload }) => {
      if (payload.actorIsAssignee) throw new ValidationError('QA_SELF_VERIFY', 'QA_SELF_VERIFY: исполнитель не принимает свою работу');
      if (!payload.hasProof) throw new ValidationError('PROOF_REQUIRED', 'PROOF_REQUIRED: нужно фото-подтверждение выполнения');
    },
  },
  reopen: { from: ['DONE', 'VERIFIED'], to: 'IN_PROGRESS', permission: 'workorder.verify', guard: ({ payload }) => { if (!payload.reason?.trim()) throw new ValidationError('REASON_REQUIRED'); } },
  cancel: { from: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'], to: 'CANCELLED', permission: 'workorder.manage', guard: ({ payload }) => { if (!payload.reason?.trim()) throw new ValidationError('REASON_REQUIRED'); } },
});

/** BR-P31: operationalStatus юнита из открытых заявок: CRITICAL → CRITICAL; иначе есть открытые → ISSUE; нет → NORMAL. BLOCKED — только вручную. */
export function operationalStatusFromWorkOrders(open: { priority: WorkOrderPriority; status: WorkOrderStatus }[], current: OperationalStatus): OperationalStatus {
  const live = open.filter((w) => OPEN_WORK_ORDER_STATUSES.includes(w.status) && w.status !== 'DONE');
  if (current === 'BLOCKED') return 'BLOCKED';
  if (live.some((w) => w.priority === 'CRITICAL')) return 'CRITICAL';
  if (live.length > 0) return 'ISSUE';
  return 'NORMAL';
}

export function isOverdue(w: { status: WorkOrderStatus; slaDueAt: Date }, now: Date): boolean {
  return (w.status === 'OPEN' || w.status === 'ASSIGNED' || w.status === 'IN_PROGRESS') && w.slaDueAt < now;
}
