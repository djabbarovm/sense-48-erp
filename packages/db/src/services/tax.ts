/**
 * F-01: TaxCalendarRule + TaxObligation (docs/02 §6, docs/04).
 * PLANNED → CALCULATED [ACCOUNTANT/LEAD] → APPROVED [LEAD/OWNER] →
 * (PaymentRequest source=TAX_OBLIGATION) → PAID (из сверки) → FILED [ACCOUNTANT];
 * просрочка до PAID → OVERDUE + эскалация Owner.
 */
import type { TenantContext } from '@finance-os/core';
import { ValidationError, requirePermission } from '@finance-os/core';
import type { TaxObligationStatus, TaxType } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';
import { createPaymentRequest } from './payments.js';

// ── Rules ──

export async function upsertTaxRule(
  ctx: TenantContext,
  input: {
    id?: string;
    type: TaxType;
    name: string;
    recurrence?: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
    dueDay: number;
    expectedMinMinor?: bigint | null;
    expectedMaxMinor?: bigint | null;
    ownerId?: string | null;
  },
) {
  requirePermission(ctx, 'tax.approve'); // настройка правил — Lead/Owner (docs/06 §15: Admin/Lead)
  if (input.dueDay < 1 || input.dueDay > 28) throw new ValidationError('DUE_DAY_INVALID', 'Число месяца 1–28');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const data = {
      type: input.type,
      name: input.name,
      recurrence: input.recurrence ?? 'MONTHLY',
      dueDay: input.dueDay,
      expectedMinMinor: input.expectedMinMinor ?? null,
      expectedMaxMinor: input.expectedMaxMinor ?? null,
      ownerId: input.ownerId ?? null,
    };
    if (input.id) {
      const existing = await tx.taxCalendarRule.findFirst({ where: { id: input.id, tenantId: ctx.tenantId } });
      if (!existing) throw new ValidationError('NOT_FOUND');
    }
    const rule = input.id
      ? await tx.taxCalendarRule.update({ where: { id: input.id }, data })
      : await tx.taxCalendarRule.create({ data: { tenantId: ctx.tenantId, ...data } });
    return {
      result: rule,
      audit: { action: 'tax_rule.upsert', objectType: 'tax_calendar_rule', objectId: rule.id, after: { type: input.type, name: input.name, dueDay: input.dueDay } },
    };
  });
}

export async function listTaxRules(ctx: TenantContext) {
  requirePermission(ctx, 'payment.view');
  return prisma.taxCalendarRule.findMany({ where: whereTenant(ctx, { isActive: true }), orderBy: { dueDay: 'asc' } });
}

/** Job (D-05/F-01): создаёт PLANNED-обязательства на ближайшие периоды из правил. Идемпотентен. */
export async function generateTaxObligations(tenantId: string, now = new Date(), monthsAhead = 2): Promise<number> {
  const rules = await prisma.taxCalendarRule.findMany({ where: { tenantId, isActive: true } });
  let created = 0;
  for (const rule of rules) {
    const periods: { period: string; due: Date }[] = [];
    for (let i = 0; i <= monthsAhead; i++) {
      const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      if (rule.recurrence === 'QUARTERLY' && base.getUTCMonth() % 3 !== 0) continue; // due в 1-й месяц квартала за прошлый квартал
      if (rule.recurrence === 'YEARLY' && base.getUTCMonth() !== 0) continue;
      // период = предыдущий месяц/квартал/год относительно месяца дедлайна
      const prev = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 1, 1));
      const period =
        rule.recurrence === 'MONTHLY'
          ? prev.toISOString().slice(0, 7)
          : rule.recurrence === 'QUARTERLY'
            ? `${prev.getUTCFullYear()}-Q${Math.floor(prev.getUTCMonth() / 3) + 1}`
            : String(prev.getUTCFullYear());
      periods.push({ period, due: new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), rule.dueDay)) });
    }
    for (const { period, due } of periods) {
      const exists = await prisma.taxObligation.findUnique({
        where: { tenantId_type_period: { tenantId, type: rule.type, period } },
      });
      if (exists) continue;
      await prisma.taxObligation.create({
        data: {
          tenantId,
          type: rule.type,
          name: rule.name,
          period,
          dueDate: due,
          expectedMinMinor: rule.expectedMinMinor,
          expectedMaxMinor: rule.expectedMaxMinor,
          ownerId: rule.ownerId,
        },
      });
      created++;
    }
  }
  return created;
}

// ── Obligation workflow ──

export async function calculateTaxObligation(ctx: TenantContext, id: string, calculatedMinor: bigint) {
  requirePermission(ctx, 'tax.calculate');
  if (calculatedMinor <= 0n) throw new ValidationError('AMOUNT_INVALID');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const obligation = await findScopedOr404(tx.taxObligation, ctx, id);
    if (!['PLANNED', 'CALCULATED', 'OVERDUE'].includes(obligation.status)) {
      throw new ValidationError('TAX_NOT_CALCULABLE', `Статус ${obligation.status}`);
    }
    // сверка c ожидаемым коридором — предупреждение задачей, не блок
    const outOfRange =
      (obligation.expectedMinMinor != null && calculatedMinor < obligation.expectedMinMinor) ||
      (obligation.expectedMaxMinor != null && calculatedMinor > obligation.expectedMaxMinor);
    const after = await tx.taxObligation.update({
      where: { id },
      data: { calculatedMinor, status: 'CALCULATED', updatedBy: ctx.userId },
    });
    if (outOfRange) {
      await tx.task.create({
        data: {
          tenantId: ctx.tenantId,
          type: 'TAX_PREP',
          objectType: 'tax_obligation',
          objectId: id,
          nextAction: `Налог ${obligation.name} ${obligation.period}: расчёт вне ожидаемого коридора — проверить до утверждения`,
          createdBy: ctx.userId,
        },
      });
    }
    return {
      result: after,
      audit: {
        action: 'tax.calculate',
        objectType: 'tax_obligation',
        objectId: id,
        before: { status: obligation.status },
        after: { status: 'CALCULATED', calculatedMinor: calculatedMinor.toString(), outOfRange },
      },
    };
  });
}

export async function approveTaxObligation(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'tax.approve');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const obligation = await findScopedOr404(tx.taxObligation, ctx, id);
    if (obligation.status !== 'CALCULATED') throw new ValidationError('TAX_NOT_CALCULATED', `Статус ${obligation.status}`);
    const after = await tx.taxObligation.update({ where: { id }, data: { status: 'APPROVED', updatedBy: ctx.userId } });
    return {
      result: after,
      audit: { action: 'tax.approve', objectType: 'tax_obligation', objectId: id, before: { status: 'CALCULATED' }, after: { status: 'APPROVED' } },
    };
  });
}

/** Платёж по налогу: source TAX_OBLIGATION (BR-001 соблюдён). */
export async function createTaxPayment(ctx: TenantContext, id: string) {
  const obligation = await findScopedOr404(prisma.taxObligation, ctx, id);
  if (obligation.status !== 'APPROVED') throw new ValidationError('TAX_NOT_APPROVED', `Статус ${obligation.status}`);
  if (!obligation.calculatedMinor) throw new ValidationError('TAX_NOT_CALCULATED');
  if (obligation.paymentRequestId) throw new ValidationError('TAX_PAYMENT_EXISTS', 'Платёж уже создан');
  const payment = await createPaymentRequest(ctx, {
    sourceType: 'TAX_OBLIGATION',
    sourceId: obligation.id,
    requestedMinor: obligation.calculatedMinor,
    purposeNote: `${obligation.name} за ${obligation.period}`,
    dueDate: obligation.dueDate,
  });
  await prisma.taxObligation.update({ where: { id }, data: { paymentRequestId: payment.id, updatedBy: ctx.userId } });
  return payment;
}

export async function fileTaxObligation(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'tax.file');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const obligation = await findScopedOr404(tx.taxObligation, ctx, id);
    if (obligation.status !== 'PAID') throw new ValidationError('TAX_NOT_PAID', 'FILED — после оплаты (docs/04)');
    const after = await tx.taxObligation.update({
      where: { id },
      data: { status: 'FILED', filedAt: new Date(), updatedBy: ctx.userId },
    });
    return {
      result: after,
      audit: { action: 'tax.file', objectType: 'tax_obligation', objectId: id, before: { status: 'PAID' }, after: { status: 'FILED' } },
    };
  });
}

/** Вызывается из bank-сверки: платёж по налогу оплачен → obligation PAID. */
export async function markTaxObligationPaid(tenantId: string, obligationId: string): Promise<void> {
  const obligation = await prisma.taxObligation.findFirst({ where: { id: obligationId, tenantId } });
  if (!obligation || ['PAID', 'FILED'].includes(obligation.status)) return;
  await withAudit({ tenantId }, async (tx) => ({
    result: await tx.taxObligation.update({ where: { id: obligationId }, data: { status: 'PAID' } }),
    audit: {
      action: 'tax.paid',
      objectType: 'tax_obligation',
      objectId: obligationId,
      before: { status: obligation.status },
      after: { status: 'PAID' },
    },
  }));
}

/** Job: просрочка до PAID → OVERDUE + эскалация Owner задачей. */
export async function markOverdueTaxObligations(tenantId: string, now = new Date()): Promise<number> {
  const overdue = await prisma.taxObligation.findMany({
    where: { tenantId, status: { in: ['PLANNED', 'CALCULATED', 'APPROVED'] }, dueDate: { lt: now } },
  });
  const owner = await prisma.userTenantRole.findFirst({ where: { tenantId, role: 'OWNER' } });
  for (const obligation of overdue) {
    await withAudit({ tenantId }, async (tx) => {
      const after = await tx.taxObligation.update({ where: { id: obligation.id }, data: { status: 'OVERDUE' } });
      await tx.task.create({
        data: {
          tenantId,
          type: 'TAX_PREP',
          objectType: 'tax_obligation',
          objectId: obligation.id,
          ownerId: obligation.ownerId,
          escalateToId: owner?.userId ?? null,
          escalatedAt: now,
          dueAt: obligation.dueDate,
          nextAction: `ПРОСРОЧЕН налог ${obligation.name} за ${obligation.period} (срок ${obligation.dueDate.toISOString().slice(0, 10)}) — срочно рассчитать/оплатить`,
        },
      });
      return {
        result: after,
        audit: { action: 'tax.overdue', objectType: 'tax_obligation', objectId: obligation.id, before: { status: obligation.status }, after: { status: 'OVERDUE' } },
      };
    });
  }
  return overdue.length;
}

export async function listTaxObligations(ctx: TenantContext, filter?: { status?: TaxObligationStatus[] }) {
  requirePermission(ctx, 'payment.view');
  return prisma.taxObligation.findMany({
    where: whereTenant(ctx, filter?.status ? { status: { in: filter.status } } : {}),
    orderBy: { dueDate: 'asc' },
    take: 120,
  });
}
