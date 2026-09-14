/**
 * C-07: Advance (docs/02 §4, docs/04, BR-022/046).
 */
import type { TenantContext } from '@finance-os/core';
import { ValidationError, hasRole, requirePermission } from '@finance-os/core';
import type { AdvanceStatus, PaymentRequest, Prisma } from '@prisma/client';
import { withAudit, writeAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';

type Tx = Prisma.TransactionClient;

/** Рабочие дни c учётом Holiday (D-11). */
export async function addBusinessDays(tx: Tx, start: Date, days: number): Promise<Date> {
  const holidays = new Set(
    (await tx.holiday.findMany({ where: { country: 'UZ' } })).map((h) => h.date.toISOString().slice(0, 10)),
  );
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow === 0 || dow === 6) continue; // Сб/Вс
    if (holidays.has(result.toISOString().slice(0, 10))) continue;
    added++;
  }
  return result;
}

/**
 * BR-022: при PAID prepayment создаётся Advance(VENDOR_PREPAYMENT) + Task
 * CLOSING_DOCS c due = expected date + category.closing_doc_sla_days раб. дней,
 * owner — Document Controller, эскалация — Lead. Вызывается из reconciliation.
 */
export async function createVendorPrepaymentAdvance(tx: Tx, ctx: TenantContext, payment: PaymentRequest) {
  const category = payment.categoryId
    ? await tx.category.findUnique({ where: { id: payment.categoryId } })
    : null;
  const slaDays = category?.closingDocSlaDays ?? 10;
  const baseDate = payment.dueDate ?? payment.paidAt ?? new Date();
  const dueDocsDate = await addBusinessDays(tx, baseDate, slaDays);

  const advance = await tx.advance.create({
    data: {
      tenantId: ctx.tenantId,
      type: 'VENDOR_PREPAYMENT',
      vendorId: payment.vendorId,
      paymentRequestId: payment.id,
      amountMinor: payment.requestedMinor,
      purpose: payment.purposeNote,
      eventId: payment.eventId,
      costCenterId: payment.costCenterId,
      dueDocsDate,
      createdBy: ctx.userId,
    },
  });
  // owner Task — Document Controller tenant'а (первый найденный), эскалация — Lead
  const docController = await tx.userTenantRole.findFirst({
    where: { tenantId: ctx.tenantId, role: 'DOCUMENT_CONTROLLER' },
  });
  const lead = await tx.userTenantRole.findFirst({
    where: { tenantId: ctx.tenantId, role: 'FINANCE_OPS_LEAD' },
  });
  await tx.task.create({
    data: {
      tenantId: ctx.tenantId,
      type: 'CLOSING_DOCS',
      objectType: 'advance',
      objectId: advance.id,
      ownerId: docController?.userId ?? null,
      escalateToId: lead?.userId ?? null,
      dueAt: dueDocsDate,
      nextAction: `Получить закрывающие документы по предоплате ${payment.number} (${payment.purposeNote}) до ${dueDocsDate.toISOString().slice(0, 10)}`,
    },
  });
  await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, {
    action: 'advance.create',
    objectType: 'advance',
    objectId: advance.id,
    after: {
      type: 'VENDOR_PREPAYMENT',
      paymentRequestId: payment.id,
      amountMinor: payment.requestedMinor.toString(),
      dueDocsDate: dueDocsDate.toISOString().slice(0, 10),
    },
  });
  return advance;
}

/** BR-046: новый employee advance при существующем OVERDUE у сотрудника — блок (exception Owner). */
export async function createEmployeeAdvance(
  ctx: TenantContext,
  input: { employeeId: string; amountMinor: bigint; purpose: string; dueDocsDate: Date; ownerOverrideReason?: string },
) {
  // финансовые роли (payment.create) или Owner (override-путь BR-046)
  if (!hasRole(ctx, 'OWNER')) requirePermission(ctx, 'payment.create');
  if (input.amountMinor <= 0n) throw new ValidationError('AMOUNT_INVALID');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const employee = await tx.employee.findFirst({ where: { id: input.employeeId, tenantId: ctx.tenantId } });
    if (!employee) throw new ValidationError('EMPLOYEE_NOT_FOUND');
    const overdue = await tx.advance.count({
      where: { tenantId: ctx.tenantId, type: 'EMPLOYEE_ADVANCE', employeeId: input.employeeId, status: 'OVERDUE' },
    });
    if (overdue > 0) {
      const isOwnerOverride = hasRole(ctx, 'OWNER') && input.ownerOverrideReason?.trim();
      if (!isOwnerOverride) {
        throw new ValidationError('ADVANCE_OVERDUE_EXISTS', 'У сотрудника есть просроченный подотчёт (BR-046); новый — только Owner c причиной');
      }
    }
    const created = await tx.advance.create({
      data: {
        tenantId: ctx.tenantId,
        type: 'EMPLOYEE_ADVANCE',
        employeeId: input.employeeId,
        amountMinor: input.amountMinor,
        purpose: input.purpose,
        dueDocsDate: input.dueDocsDate,
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'advance.create',
        objectType: 'advance',
        objectId: created.id,
        after: { type: 'EMPLOYEE_ADVANCE', employeeId: input.employeeId, amountMinor: input.amountMinor.toString(), override: input.ownerOverrideReason ?? null },
      },
    };
  });
}

/** Закрытие документами/возвратом: OPEN|PARTIALLY_CLOSED|OVERDUE → PARTIALLY_CLOSED|CLOSED. */
export async function closeAdvance(
  ctx: TenantContext,
  advanceId: string,
  input: { closedMinor?: bigint; returnedMinor?: bigint },
) {
  requirePermission(ctx, 'advance.close');
  const addClosed = input.closedMinor ?? 0n;
  const addReturned = input.returnedMinor ?? 0n;
  if (addClosed < 0n || addReturned < 0n || addClosed + addReturned === 0n) {
    throw new ValidationError('AMOUNT_INVALID');
  }
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const advance = await findScopedOr404(tx.advance, ctx, advanceId);
    if (!['OPEN', 'PARTIALLY_CLOSED', 'OVERDUE'].includes(advance.status)) {
      throw new ValidationError('ADVANCE_NOT_CLOSABLE', `Статус ${advance.status}`);
    }
    const closed = advance.closedMinor + addClosed;
    const returned = advance.returnedMinor + addReturned;
    if (closed + returned > advance.amountMinor) {
      throw new ValidationError('OVERCLOSED', 'closed + returned > amount (docs/02 §8)');
    }
    const status: AdvanceStatus = closed + returned === advance.amountMinor ? 'CLOSED' : 'PARTIALLY_CLOSED';
    const after = await tx.advance.update({
      where: { id: advanceId },
      data: { closedMinor: closed, returnedMinor: returned, status, updatedBy: ctx.userId },
    });
    if (status === 'CLOSED') {
      await tx.task.updateMany({
        where: { tenantId: ctx.tenantId, objectType: 'advance', objectId: advanceId, status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] } },
        data: { status: 'DONE' },
      });
    }
    return {
      result: after,
      audit: {
        action: 'advance.close_part',
        objectType: 'advance',
        objectId: advanceId,
        before: { status: advance.status, closedMinor: advance.closedMinor.toString() },
        after: { status, closedMinor: closed.toString(), returnedMinor: returned.toString() },
      },
    };
  });
}

/** Write-off — только OWNER (docs/04). */
export async function writeOffAdvance(ctx: TenantContext, advanceId: string, reason: string) {
  requirePermission(ctx, 'advance.write_off');
  if (!reason.trim()) throw new ValidationError('REASON_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const advance = await findScopedOr404(tx.advance, ctx, advanceId);
    if (!['OVERDUE', 'OPEN', 'PARTIALLY_CLOSED'].includes(advance.status)) {
      throw new ValidationError('ADVANCE_NOT_WRITABLE');
    }
    const after = await tx.advance.update({ where: { id: advanceId }, data: { status: 'WRITTEN_OFF', updatedBy: ctx.userId } });
    return {
      result: after,
      audit: {
        action: 'advance.write_off',
        objectType: 'advance',
        objectId: advanceId,
        before: { status: advance.status },
        after: { status: 'WRITTEN_OFF', reason },
      },
    };
  });
}

/** Заглушка для D-05 job: просроченные advance → OVERDUE + Task эскалации. */
export async function markOverdueAdvances(tenantId: string, now = new Date()): Promise<number> {
  const overdue = await prisma.advance.findMany({
    where: { tenantId, status: { in: ['OPEN', 'PARTIALLY_CLOSED'] }, dueDocsDate: { not: null, lt: now } },
  });
  for (const advance of overdue) {
    await withAudit({ tenantId }, async (tx) => {
      const after = await tx.advance.update({ where: { id: advance.id }, data: { status: 'OVERDUE' } });
      await tx.task.updateMany({
        where: { tenantId, objectType: 'advance', objectId: advance.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        data: { status: 'OVERDUE', escalatedAt: now },
      });
      return {
        result: after,
        audit: {
          action: 'advance.overdue',
          objectType: 'advance',
          objectId: advance.id,
          before: { status: advance.status },
          after: { status: 'OVERDUE' },
        },
      };
    });
  }
  return overdue.length;
}

export async function listAdvances(ctx: TenantContext, filter?: { status?: AdvanceStatus[] }) {
  requirePermission(ctx, 'payment.view');
  return prisma.advance.findMany({
    where: whereTenant(ctx, filter?.status ? { status: { in: filter.status } } : {}),
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}
