import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundError, unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import { createManualTask, escalateOverdueTasks, listTasks, setTaskStatus } from '../src/services/tasks.js';

let tenantId: string;
let otherTenantId: string;
const junior = () =>
  unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['JUNIOR_FINANCE'] });

beforeAll(async () => {
  const ts = Date.now();
  tenantId = (
    await prisma.tenant.create({ data: { slug: `t-b10-${ts}`, legalName: 'B10', taxId: '300000020' } })
  ).id;
  otherTenantId = (
    await prisma.tenant.create({ data: { slug: `t-b10b-${ts}`, legalName: 'B10b', taxId: '300000021' } })
  ).id;
});

afterAll(async () => prisma.$disconnect());

describe('B-10 Task', () => {
  it('OPEN → IN_PROGRESS (берёт owner) → DONE; невалидные переходы отклоняются', async () => {
    const task = await createManualTask(junior(), {
      type: 'MISSING_DOC',
      objectType: 'invoice',
      objectId: crypto.randomUUID(),
      nextAction: 'Запросить акт у поставщика',
    });
    const ctx = junior();
    const inProgress = await setTaskStatus(ctx, task.id, 'IN_PROGRESS');
    expect(inProgress.ownerId).toBe(ctx.userId);
    const done = await setTaskStatus(ctx, task.id, 'DONE');
    expect(done.status).toBe('DONE');
    await expect(setTaskStatus(ctx, task.id, 'IN_PROGRESS')).rejects.toThrow(/DONE → IN_PROGRESS/);
  });

  it('CANCELLED требует причину', async () => {
    const task = await createManualTask(junior(), {
      type: 'AR_FOLLOWUP',
      objectType: 'customer',
      objectId: crypto.randomUUID(),
      nextAction: 'Позвонить клиенту',
    });
    await expect(setTaskStatus(junior(), task.id, 'CANCELLED')).rejects.toThrow(/причин/);
    const cancelled = await setTaskStatus(junior(), task.id, 'CANCELLED', 'объект закрыт иначе');
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('escalateOverdueTasks: просроченные → OVERDUE, повторно не трогает', async () => {
    await createManualTask(junior(), {
      type: 'CLOSING_DOCS',
      objectType: 'advance',
      objectId: crypto.randomUUID(),
      nextAction: 'Получить закрывающие',
      dueAt: new Date('2026-01-01'),
    });
    expect(await escalateOverdueTasks(tenantId)).toBe(1);
    expect(await escalateOverdueTasks(tenantId)).toBe(0);
    const overdue = await listTasks(junior(), { status: ['OVERDUE'] });
    expect(overdue.length).toBe(1);
    expect(overdue[0]!.escalatedAt).not.toBeNull();
  });

  it('cross-tenant task → 404', async () => {
    const foreign = await prisma.task.create({
      data: {
        tenantId: otherTenantId,
        type: 'MISSING_DOC',
        objectType: 'x',
        objectId: crypto.randomUUID(),
        nextAction: 'x',
      },
    });
    await expect(setTaskStatus(junior(), foreign.id, 'DONE')).rejects.toThrow(NotFoundError);
  });
});
