import { describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext, type RoleCode } from '../context/index.js';
import { isOverdue, operationalStatusFromWorkOrders, slaDueAt, workOrderMachine } from './workOrder.js';

const ctx = (...roles: RoleCode[]) => unsafeCreateTenantContext({ tenantId: 't', tenantSlug: 't', userId: 'u', roles });
const p = { hasAssignee: true, hasProof: true, actorIsAssignee: false };

describe('Заявки (docs/20 §11.5)', () => {
  it('SLA по приоритету; просрочка только для открытых', () => {
    const c = new Date('2026-09-18T10:00:00Z');
    expect(slaDueAt('CRITICAL', c).toISOString()).toBe('2026-09-18T14:00:00.000Z');
    expect(slaDueAt('LOW', c).toISOString()).toBe('2026-09-25T10:00:00.000Z');
    expect(isOverdue({ status: 'OPEN', slaDueAt: c }, new Date('2026-09-19'))).toBe(true);
    expect(isOverdue({ status: 'DONE', slaDueAt: c }, new Date('2026-09-19'))).toBe(false);
  });
  it('state machine: assign требует исполнителя, verify — фото и не самого исполнителя (BR-P32), reopen/cancel — причину', () => {
    expect(() => workOrderMachine.assert(ctx('OPERATIONS_MANAGER'), 'OPEN', 'assign', { ...p, hasAssignee: false })).toThrow(/ASSIGNEE_REQUIRED/);
    expect(workOrderMachine.assert(ctx('OPERATIONS_MANAGER'), 'OPEN', 'assign', p)).toBe('ASSIGNED');
    expect(workOrderMachine.assert(ctx('OPERATIONS_MANAGER'), 'ASSIGNED', 'start', p)).toBe('IN_PROGRESS');
    expect(workOrderMachine.assert(ctx('OPERATIONS_MANAGER'), 'IN_PROGRESS', 'done', p)).toBe('DONE');
    expect(() => workOrderMachine.assert(ctx('OPERATIONS_MANAGER'), 'DONE', 'verify', { ...p, actorIsAssignee: true })).toThrow(/QA_SELF_VERIFY/);
    expect(() => workOrderMachine.assert(ctx('OPERATIONS_MANAGER'), 'DONE', 'verify', { ...p, hasProof: false })).toThrow(/PROOF_REQUIRED/);
    expect(workOrderMachine.assert(ctx('COMMERCIAL_MANAGER'), 'DONE', 'verify', p)).toBe('VERIFIED');
    expect(() => workOrderMachine.assert(ctx('OPERATIONS_MANAGER'), 'VERIFIED', 'reopen', p)).toThrow(/REASON_REQUIRED/);
    expect(workOrderMachine.assert(ctx('OPERATIONS_MANAGER'), 'VERIFIED', 'reopen', { ...p, reason: 'снова течёт' })).toBe('IN_PROGRESS');
    expect(workOrderMachine.can(ctx('BROKER'), 'OPEN', 'start', p)).toBe(false);
    expect(workOrderMachine.can(ctx('OPERATIONS_MANAGER'), 'VERIFIED', 'cancel', { ...p, reason: 'x' })).toBe(false);
  });
  it('BR-P31: operationalStatus из открытых заявок; BLOCKED сохраняется', () => {
    expect(operationalStatusFromWorkOrders([], 'ISSUE')).toBe('NORMAL');
    expect(operationalStatusFromWorkOrders([{ priority: 'NORMAL', status: 'OPEN' }], 'NORMAL')).toBe('ISSUE');
    expect(operationalStatusFromWorkOrders([{ priority: 'CRITICAL', status: 'IN_PROGRESS' }, { priority: 'LOW', status: 'OPEN' }], 'NORMAL')).toBe('CRITICAL');
    expect(operationalStatusFromWorkOrders([{ priority: 'CRITICAL', status: 'DONE' }], 'NORMAL')).toBe('NORMAL'); // выполнено, ждёт приёмки
    expect(operationalStatusFromWorkOrders([{ priority: 'CRITICAL', status: 'OPEN' }], 'BLOCKED')).toBe('BLOCKED');
  });
});
