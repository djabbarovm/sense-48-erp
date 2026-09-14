/**
 * F-02: PayrollRun (docs/02 §6, BR-047). Хранит ТОЛЬКО агрегаты — построчный
 * реестр остаётся документом (Document, PAYROLL_REGISTER); персональные данные
 * и суммы по людям в БД не попадают (docs/11).
 * BR-047: CHECKED только если все ФИО из реестра — ACTIVE сотрудники или
 * уволенные внутри периода; иначе список расхождений + Task.
 */
import type { TenantContext } from '@finance-os/core';
import { ValidationError, requirePermission } from '@finance-os/core';
import type { PayrollRunStatus } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';

export async function createPayrollRun(
  ctx: TenantContext,
  input: { period: string; employeeCount: number; grossMinor: bigint; netMinor: bigint; taxesMinor: bigint; registerDocumentId?: string | null },
) {
  requirePermission(ctx, 'payroll.prepare');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw new ValidationError('PERIOD_INVALID', 'Период — YYYY-MM');
  if (input.netMinor <= 0n || input.grossMinor < input.netMinor) throw new ValidationError('AMOUNT_INVALID', 'gross ≥ net > 0');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const exists = await tx.payrollRun.findUnique({
      where: { tenantId_period: { tenantId: ctx.tenantId, period: input.period } },
    });
    if (exists) throw new ValidationError('PAYROLL_EXISTS', `Ведомость за ${input.period} уже есть`);
    const created = await tx.payrollRun.create({
      data: {
        tenantId: ctx.tenantId,
        period: input.period,
        employeeCount: input.employeeCount,
        grossMinor: input.grossMinor,
        netMinor: input.netMinor,
        taxesMinor: input.taxesMinor,
        registerDocumentId: input.registerDocumentId ?? null,
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'payroll.create',
        objectType: 'payroll_run',
        objectId: created.id,
        after: { period: input.period, employeeCount: input.employeeCount, netMinor: input.netMinor.toString() },
      },
    };
  });
}

export interface PayrollCheckResult {
  ok: boolean;
  discrepancies: string[]; // ФИО из реестра, не прошедшие BR-047
}

/**
 * BR-047: сверка реестра (список ФИО) c активным списком сотрудников.
 * Допустимы: ACTIVE, либо TERMINATED c terminated_at внутри периода.
 */
export async function checkPayrollRun(ctx: TenantContext, id: string, registerNames: string[]): Promise<PayrollCheckResult> {
  requirePermission(ctx, 'payroll.prepare');
  if (registerNames.length === 0) throw new ValidationError('REGISTER_EMPTY');
  const run = await findScopedOr404(prisma.payrollRun, ctx, id);
  if (!['DRAFT', 'CHECKED'].includes(run.status)) throw new ValidationError('PAYROLL_NOT_CHECKABLE', `Статус ${run.status}`);
  const [y, m] = run.period.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const employees = await prisma.employee.findMany({ where: { tenantId: ctx.tenantId } });
  const byName = new Map(employees.map((e) => [e.fullName.trim().toLowerCase(), e]));
  const discrepancies: string[] = [];
  for (const rawName of registerNames) {
    const employee = byName.get(rawName.trim().toLowerCase());
    if (!employee) {
      discrepancies.push(`${rawName} — нет в списке сотрудников`);
      continue;
    }
    if (employee.status === 'ACTIVE') continue;
    const terminatedInPeriod = employee.terminatedAt && employee.terminatedAt >= from && employee.terminatedAt < to;
    if (!terminatedInPeriod) discrepancies.push(`${rawName} — уволен вне периода (${employee.terminatedAt?.toISOString().slice(0, 10) ?? 'без даты'})`);
  }
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    if (discrepancies.length > 0) {
      await tx.task.create({
        data: {
          tenantId: ctx.tenantId,
          type: 'REVIEW_EXCEPTION',
          objectType: 'payroll_run',
          objectId: id,
          nextAction: `BR-047: ведомость ${run.period} — расхождения c активным списком (${discrepancies.length}): ${discrepancies.slice(0, 3).join('; ')}${discrepancies.length > 3 ? '…' : ''}`,
          createdBy: ctx.userId,
        },
      });
      const failed: PayrollCheckResult = { ok: false, discrepancies };
      return {
        result: failed,
        audit: {
          action: 'payroll.check_failed',
          objectType: 'payroll_run',
          objectId: id,
          after: { discrepancies: discrepancies.length },
        },
      };
    }
    await tx.payrollRun.update({
      where: { id },
      data: { status: 'CHECKED', checkedAgainstActiveListAt: new Date(), updatedBy: ctx.userId },
    });
    const passed: PayrollCheckResult = { ok: true, discrepancies: [] };
    return {
      result: passed,
      audit: {
        action: 'payroll.checked',
        objectType: 'payroll_run',
        objectId: id,
        before: { status: run.status },
        after: { status: 'CHECKED', names: registerNames.length },
      },
    };
  });
}

export async function approvePayrollRun(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'payroll.approve');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const run = await findScopedOr404(tx.payrollRun, ctx, id);
    if (run.status !== 'CHECKED') throw new ValidationError('PAYROLL_NOT_CHECKED', 'Approve — только после проверки BR-047');
    const after = await tx.payrollRun.update({ where: { id }, data: { status: 'APPROVED', updatedBy: ctx.userId } });
    return {
      result: after,
      audit: { action: 'payroll.approve', objectType: 'payroll_run', objectId: id, before: { status: 'CHECKED' }, after: { status: 'APPROVED' } },
    };
  });
}

/** Платёж по ведомости: source PAYROLL_RUN на сумму net. */
export async function createPayrollPayment(ctx: TenantContext, id: string) {
  const { createPaymentRequest } = await import('./payments.js');
  const run = await findScopedOr404(prisma.payrollRun, ctx, id);
  if (run.status !== 'APPROVED') throw new ValidationError('PAYROLL_NOT_APPROVED', `Статус ${run.status}`);
  return createPaymentRequest(ctx, {
    sourceType: 'PAYROLL_RUN',
    sourceId: run.id,
    requestedMinor: run.netMinor,
    purposeNote: `Заработная плата за ${run.period} (${run.employeeCount} чел.)`,
  });
}

/** POSTED — после проведения в 1С (кнопка бухгалтера/импорт posted). */
export async function markPayrollPosted(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'tax.file'); // ACCOUNTANT
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const run = await findScopedOr404(tx.payrollRun, ctx, id);
    if (run.status !== 'PAID') throw new ValidationError('PAYROLL_NOT_PAID', 'POSTED — после оплаты');
    const after = await tx.payrollRun.update({ where: { id }, data: { status: 'POSTED', updatedBy: ctx.userId } });
    return {
      result: after,
      audit: { action: 'payroll.posted', objectType: 'payroll_run', objectId: id, before: { status: 'PAID' }, after: { status: 'POSTED' } },
    };
  });
}

export async function listPayrollRuns(ctx: TenantContext, filter?: { status?: PayrollRunStatus[] }) {
  requirePermission(ctx, 'payment.view');
  return prisma.payrollRun.findMany({
    where: whereTenant(ctx, filter?.status ? { status: { in: filter.status } } : {}),
    orderBy: { period: 'desc' },
    take: 36,
  });
}
