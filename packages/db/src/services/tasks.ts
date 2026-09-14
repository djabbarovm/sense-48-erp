/** B-10: Task (docs/02 §7, docs/04 Task state machine). Эскалация — job в D-05. */
import type { TenantContext } from '@finance-os/core';
import { ValidationError, assertNoSecrets, requirePermission } from '@finance-os/core';
import type { TaskStatus, TaskType } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  OPEN: ['IN_PROGRESS', 'DONE', 'CANCELLED', 'OVERDUE'],
  IN_PROGRESS: ['DONE', 'CANCELLED', 'OVERDUE'],
  OVERDUE: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

export async function setTaskStatus(
  ctx: TenantContext,
  taskId: string,
  status: TaskStatus,
  reason?: string,
) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const task = await findScopedOr404(tx.task, ctx, taskId);
    if (!TRANSITIONS[task.status].includes(status)) {
      throw new ValidationError('TASK_TRANSITION_INVALID', `${task.status} → ${status}`);
    }
    if (status === 'CANCELLED' && (!reason || !reason.trim())) {
      throw new ValidationError('REASON_REQUIRED', 'Отмена задачи требует причину (docs/04)');
    }
    const after = await tx.task.update({
      where: { id: taskId },
      data: {
        status,
        ...(status === 'IN_PROGRESS' && !task.ownerId ? { ownerId: ctx.userId } : {}),
        updatedBy: ctx.userId,
      },
    });
    return {
      result: after,
      audit: {
        action: `task.${status.toLowerCase()}`,
        objectType: 'task',
        objectId: taskId,
        before: { status: task.status },
        after: { status, reason: reason ?? null },
      },
    };
  });
}

export async function listTasks(
  ctx: TenantContext,
  filter?: { mine?: boolean; status?: TaskStatus[]; type?: TaskType },
) {
  return prisma.task.findMany({
    where: whereTenant(ctx, {
      ...(filter?.mine ? { OR: [{ ownerId: ctx.userId }, { ownerId: null }] } : {}),
      ...(filter?.status ? { status: { in: filter.status } } : {}),
      ...(filter?.type ? { type: filter.type } : {}),
    }),
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
    take: 200,
  });
}

/**
 * Заглушка для D-05 job: просроченные задачи → OVERDUE + escalated_at
 * (уведомление escalate_to — в Phase D через NotificationAdapter).
 */
export async function escalateOverdueTasks(tenantId: string, now = new Date()): Promise<number> {
  const overdue = await prisma.task.findMany({
    where: { tenantId, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { not: null, lt: now } },
  });
  for (const task of overdue) {
    await withAudit({ tenantId }, async (tx) => {
      const after = await tx.task.update({
        where: { id: task.id },
        data: { status: 'OVERDUE', escalatedAt: now },
      });
      return {
        result: after,
        audit: {
          action: 'task.overdue',
          objectType: 'task',
          objectId: task.id,
          before: { status: task.status },
          after: { status: 'OVERDUE', escalatedAt: now.toISOString() },
        },
      };
    });
  }
  return overdue.length;
}

export async function createManualTask(
  ctx: TenantContext,
  input: { type: TaskType; objectType: string; objectId: string; nextAction: string; ownerId?: string; dueAt?: Date },
) {
  requirePermission(ctx, 'pr.view'); // задачи может создавать любая операционная роль
  if (!input.nextAction.trim()) throw new ValidationError('NEXT_ACTION_REQUIRED');
  assertNoSecrets(input.nextAction, 'next_action'); // BR-072
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const created = await tx.task.create({
      data: {
        tenantId: ctx.tenantId,
        type: input.type,
        objectType: input.objectType,
        objectId: input.objectId,
        nextAction: input.nextAction,
        ownerId: input.ownerId ?? null,
        dueAt: input.dueAt ?? null,
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'task.create',
        objectType: 'task',
        objectId: created.id,
        after: { type: input.type, nextAction: input.nextAction },
      },
    };
  });
}
