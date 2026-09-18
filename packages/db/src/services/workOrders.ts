/**
 * Wave 4: заявки и инциденты (docs/20 §11.5, blueprint §12). Источник истины operationalStatus юнита (BR-P31).
 * QA — не исполнитель (BR-P32); приёмка требует фото-подтверждения (Document objectType=work_order).
 */
import type { TenantContext, WorkOrderPriority, WorkOrderTrigger } from '@finance-os/core';
import { NotFoundError, ValidationError, can, isOverdue, operationalStatusFromWorkOrders, requirePermission, slaDueAt, workOrderMachine } from '@finance-os/core';
import type { Prisma, WorkOrder, WorkOrderCategory, ChangeSource } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { nextNumber } from '../sequence.js';
import { emitDomainEvent } from './domainEvents.js';

export interface WorkOrderInput {
  unitId?: string | null;
  buildingId?: string | null;
  category: WorkOrderCategory;
  priority?: WorkOrderPriority;
  title: string;
  description?: string | null;
  location?: string | null;
  assigneeId?: string | null;
  contractorName?: string | null;
  source?: ChangeSource;
}

const pick = (w: WorkOrder) => ({ status: w.status, priority: w.priority, category: w.category, assigneeId: w.assigneeId, slaDueAt: w.slaDueAt, unitId: w.unitId });

/** BR-P31: пересчёт operationalStatus юнита по открытым заявкам (BLOCKED остаётся ручным). */
export async function recomputeUnitOperationalStatus(tx: Prisma.TransactionClient, tenantId: string, unitId: string, now = new Date()): Promise<void> {
  const unit = await tx.unit.findFirst({ where: { id: unitId, tenantId } });
  if (!unit) return;
  const open = await tx.workOrder.findMany({ where: { tenantId, unitId, status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE'] } }, select: { priority: true, status: true } });
  const next = operationalStatusFromWorkOrders(open, unit.operationalStatus);
  if (next !== unit.operationalStatus) {
    await tx.unit.update({ where: { id: unitId }, data: { operationalStatus: next, statusEffectiveAt: now } });
    await emitDomainEvent(tx, tenantId, 'unit.status.changed', 'unit', unitId, { unitNo: unit.unitNo, operationalStatus: next, detail: 'from work orders', deepLink: `/property/units/${unitId}` });
  }
}

export async function createWorkOrder(ctx: TenantContext, input: WorkOrderInput, now = new Date()): Promise<WorkOrder> {
  // Собственник (owner.request) заводит заявку только по своему юниту (BR-P33); остальным нужен workorder.create
  const asOwner = !can(ctx, 'workorder.create');
  if (asOwner) requirePermission(ctx, 'owner.request');
  if (!input.title.trim()) throw new ValidationError('TITLE_REQUIRED');
  if (!input.unitId && !input.buildingId) throw new ValidationError('LOCATION_REQUIRED', 'LOCATION_REQUIRED: укажите юнит или здание');
  if (asOwner && !input.unitId) throw new ValidationError('LOCATION_REQUIRED');
  const priority = asOwner ? (input.priority === 'CRITICAL' ? 'HIGH' : (input.priority ?? 'NORMAL')) : (input.priority ?? 'NORMAL');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const unit = input.unitId ? await findScopedOr404(tx.unit, ctx, input.unitId) : null;
    if (asOwner) {
      const owner = await tx.propertyOwner.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId }, select: { id: true } });
      if (!owner || unit?.ownerId !== owner.id) throw new NotFoundError();
    }
    if (input.buildingId) await findScopedOr404(tx.building, ctx, input.buildingId);
    const number = await nextNumber(tx, ctx.tenantId, 'WO', now);
    const assigneeId = can(ctx, 'workorder.manage') ? (input.assigneeId ?? null) : null;
    const created = await tx.workOrder.create({
      data: {
        tenantId: ctx.tenantId, number, unitId: unit?.id ?? null, buildingId: unit?.buildingId ?? input.buildingId ?? null, category: input.category, priority,
        status: assigneeId ? 'ASSIGNED' : 'OPEN', title: input.title.trim(), description: input.description ?? null, location: input.location ?? null,
        reporterId: ctx.userId, assigneeId, contractorName: input.contractorName ?? null, source: asOwner ? 'API' : (input.source ?? 'UI'), slaDueAt: slaDueAt(priority, now), createdAt: now,
      },
    });
    if (unit) await recomputeUnitOperationalStatus(tx, ctx.tenantId, unit.id, now);
    await emitDomainEvent(tx, ctx.tenantId, 'work_order.created', 'work_order', created.id, { number, unitNo: unit?.unitNo ?? null, priority, category: input.category, detail: created.title.slice(0, 80), deepLink: `/workorders/${created.id}` });
    return { result: created, audit: { action: 'work_order.create', objectType: 'work_order', objectId: created.id, after: { number, ...pick(created), title: created.title } } };
  });
}

export async function transitionWorkOrder(ctx: TenantContext, id: string, trigger: WorkOrderTrigger, input: { assigneeId?: string | null; contractorName?: string | null; reason?: string } = {}, now = new Date()): Promise<WorkOrder> {
  requirePermission(ctx, 'workorder.view');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.workOrder, ctx, id);
    const assigneeId = trigger === 'assign' ? (input.assigneeId ?? before.assigneeId) : before.assigneeId;
    const proofs = await tx.document.count({ where: { tenantId: ctx.tenantId, objectType: 'work_order', objectId: id } });
    const to = workOrderMachine.assert(ctx, before.status, trigger, { hasAssignee: !!assigneeId, hasProof: proofs > 0, reason: input.reason, actorIsAssignee: before.assigneeId === ctx.userId });
    const after = await tx.workOrder.update({
      where: { id },
      data: {
        status: to, updatedBy: ctx.userId,
        ...(trigger === 'assign' ? { assigneeId, ...(input.contractorName !== undefined ? { contractorName: input.contractorName } : {}) } : {}),
        ...(trigger === 'start' ? { startedAt: now } : {}),
        ...(trigger === 'done' ? { doneAt: now } : {}),
        ...(trigger === 'verify' ? { verifiedAt: now, verifiedBy: ctx.userId } : {}),
        ...(trigger === 'reopen' ? { doneAt: null, verifiedAt: null, verifiedBy: null } : {}),
        ...(trigger === 'cancel' ? { cancelReason: input.reason?.trim() ?? null } : {}),
      },
    });
    if (after.unitId) await recomputeUnitOperationalStatus(tx, ctx.tenantId, after.unitId, now);
    await emitDomainEvent(tx, ctx.tenantId, 'work_order.status.changed', 'work_order', id, { number: after.number, status: to, detail: trigger, deepLink: `/workorders/${id}` });
    return { result: after, audit: { action: `work_order.${trigger}`, objectType: 'work_order', objectId: id, before: pick(before), after: { ...pick(after), reason: input.reason ?? null } } };
  });
}

export interface WorkOrderRow extends WorkOrder {
  unitNo: string | null;
  buildingName: string | null;
  reporterName: string;
  assigneeName: string | null;
  overdue: boolean;
  hoursLeft: number | null;
  proofs: number;
}

export async function listWorkOrders(ctx: TenantContext, filter: { status?: WorkOrder['status'][]; unitId?: string; assigneeId?: string; mine?: boolean; overdueOnly?: boolean; priority?: WorkOrderPriority } = {}, now = new Date()): Promise<WorkOrderRow[]> {
  requirePermission(ctx, 'workorder.view');
  const where: Prisma.WorkOrderWhereInput = { tenantId: ctx.tenantId };
  if (filter.status) where.status = { in: filter.status };
  if (filter.unitId) where.unitId = filter.unitId;
  if (filter.assigneeId) where.assigneeId = filter.assigneeId;
  if (filter.mine) where.OR = [{ assigneeId: ctx.userId }, { reporterId: ctx.userId }];
  if (filter.priority) where.priority = filter.priority;
  const rows = await prisma.workOrder.findMany({ where, include: { unit: { select: { unitNo: true, building: { select: { name: true } } } } }, orderBy: [{ status: 'asc' }, { slaDueAt: 'asc' }] });
  const ids = [...new Set(rows.flatMap((r) => [r.reporterId, r.assigneeId].filter((x): x is string => !!x)))];
  const users = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const proofs = new Map<string, number>();
  for (const g of await prisma.document.groupBy({ by: ['objectId'], where: { tenantId: ctx.tenantId, objectType: 'work_order', objectId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })) proofs.set(g.objectId, g._count._all);
  const buildings = new Map((await prisma.building.findMany({ where: whereTenant(ctx), select: { id: true, name: true } })).map((b) => [b.id, b.name]));
  const out: WorkOrderRow[] = [];
  for (const r of rows) {
    const overdue = isOverdue(r, now);
    if (filter.overdueOnly && !overdue) continue;
    const { unit, ...rest } = r;
    out.push({ ...rest, unitNo: unit?.unitNo ?? null, buildingName: unit?.building.name ?? (r.buildingId ? (buildings.get(r.buildingId) ?? null) : null), reporterName: users.get(r.reporterId) ?? '—', assigneeName: r.assigneeId ? (users.get(r.assigneeId) ?? '—') : null, overdue, hoursLeft: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(r.status) ? Math.round((r.slaDueAt.getTime() - now.getTime()) / 360_000) / 10 : null, proofs: proofs.get(r.id) ?? 0 });
  }
  return out;
}

export async function getWorkOrder(ctx: TenantContext, id: string, now = new Date()) {
  const rows = await listWorkOrders(ctx, {}, now);
  const w = rows.find((r) => r.id === id);
  if (!w) {
    const exists = await prisma.workOrder.findFirst({ where: whereTenant(ctx, { id }) });
    if (!exists) throw new NotFoundError();
  }
  const row = w ?? (await listWorkOrders(ctx, {}, now)).find((r) => r.id === id)!;
  const proofs = await prisma.document.findMany({ where: whereTenant(ctx, { objectType: 'work_order', objectId: id }), orderBy: { createdAt: 'desc' } });
  const audit = can(ctx, 'audit.view') || can(ctx, 'workorder.manage') ? await prisma.auditLog.findMany({ where: { tenantId: ctx.tenantId, objectType: 'work_order', objectId: id }, orderBy: { seq: 'desc' }, take: 30, select: { id: true, action: true, actorId: true, at: true, after: true } }) : [];
  const payload = { hasAssignee: !!row.assigneeId, hasProof: proofs.length > 0, actorIsAssignee: row.assigneeId === ctx.userId };
  const triggers = workOrderMachine.availableTriggers(ctx, row.status, { ...payload, reason: 'x' });
  return { workOrder: row, proofs, audit, triggers, canUpload: can(ctx, 'document.upload') && ['ASSIGNED', 'IN_PROGRESS', 'DONE'].includes(row.status) };
}

export async function listAssignees(ctx: TenantContext) {
  requirePermission(ctx, 'workorder.view');
  const rows = await prisma.userTenantRole.findMany({ where: { tenantId: ctx.tenantId, role: { in: ['OPERATIONS_MANAGER', 'OWNER'] }, user: { status: 'ACTIVE' } }, include: { user: { select: { id: true, fullName: true } } }, distinct: ['userId'] });
  return rows.map((r) => ({ id: r.userId, fullName: r.user.fullName }));
}

/** Джоб workorder-sla: просроченные открытые заявки → Task WORKORDER_OVERDUE исполнителю/ops (дедуп) + событие. */
export async function escalateOverdueWorkOrders(tenantId: string, now = new Date()): Promise<number> {
  const overdue = await prisma.workOrder.findMany({ where: { tenantId, status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] }, slaDueAt: { lt: now }, overdueNotifiedAt: null } });
  let n = 0;
  for (const w of overdue) {
    await withAudit({ tenantId }, async (tx) => {
      const ops = w.assigneeId ?? (await tx.userTenantRole.findFirst({ where: { tenantId, role: 'OPERATIONS_MANAGER' }, select: { userId: true } }))?.userId ?? null;
      const exists = await tx.task.count({ where: { tenantId, type: 'WORKORDER_OVERDUE', objectId: w.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
      if (!exists) await tx.task.create({ data: { tenantId, type: 'WORKORDER_OVERDUE', objectType: 'work_order', objectId: w.id, ownerId: ops, dueAt: w.slaDueAt, nextAction: `Заявка ${w.number} (${w.priority}) просрочила SLA: выполнить или переназначить, при необходимости эскалировать` } });
      const after = await tx.workOrder.update({ where: { id: w.id }, data: { overdueNotifiedAt: now } });
      await emitDomainEvent(tx, tenantId, 'work_order.overdue', 'work_order', w.id, { number: w.number, priority: w.priority, detail: `SLA ${w.slaDueAt.toISOString()}`, deepLink: `/workorders/${w.id}` });
      return { result: after, audit: { action: 'work_order.overdue', objectType: 'work_order', objectId: w.id, after: { slaDueAt: w.slaDueAt, ownerId: ops } } };
    });
    n++;
  }
  return n;
}
