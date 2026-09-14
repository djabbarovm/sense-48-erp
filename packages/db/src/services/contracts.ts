/**
 * B-02: Contract CRUD + state machine + баланс (docs/02, docs/04).
 * Полный v_contract_balance (paid/requested из PaymentRequest) достраивается
 * в Phase C-01; интерфейс getContractBalance стабилен уже сейчас.
 */
import type { ContractTrigger, TenantContext } from '@finance-os/core';
import {
  NotFoundError,
  ValidationError,
  contractMachine,
  requirePermission,
  type ContractStatus as CoreContractStatus,
} from '@finance-os/core';
import type { ContractStatus, CounterpartyType, Prisma } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';

export interface ContractInput {
  number: string;
  counterpartyType: CounterpartyType;
  vendorId?: string;
  customerId?: string;
  subject: string;
  currency?: string;
  fxRate?: string | null;
  limitMinor?: bigint | null;
  startDate: Date;
  endDate?: Date | null;
  autoRenew?: boolean;
  paymentTerms?: { type: 'PREPAY_PCT' | 'POSTPAY_DAYS' | 'SCHEDULE'; value: number | string };
  requiredDocs?: string[];
  registrationRequired?: boolean;
  ownerId?: string | null;
}

export async function createContract(ctx: TenantContext, input: ContractInput) {
  requirePermission(ctx, 'contract.create');
  if (!input.number.trim() || !input.subject.trim()) throw new ValidationError('REQUIRED_FIELDS');
  if (input.counterpartyType === 'VENDOR') {
    if (!input.vendorId) throw new ValidationError('VENDOR_REQUIRED');
    const vendor = await prisma.vendor.findFirst({ where: { id: input.vendorId, tenantId: ctx.tenantId } });
    if (!vendor) throw new NotFoundError();
  } else {
    if (!input.customerId) throw new ValidationError('CUSTOMER_REQUIRED');
    const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId } });
    if (!customer) throw new NotFoundError();
  }
  // D-08: договор в валюте ≠ base требует курс на дату
  const currency = input.currency ?? 'UZS';
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const created = await tx.contract.create({
      data: {
        tenantId: ctx.tenantId,
        number: input.number,
        counterpartyType: input.counterpartyType,
        vendorId: input.counterpartyType === 'VENDOR' ? input.vendorId! : null,
        customerId: input.counterpartyType === 'CUSTOMER' ? input.customerId! : null,
        subject: input.subject,
        currency,
        fxRate: input.fxRate ?? null,
        limitMinor: input.limitMinor ?? null,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        autoRenew: input.autoRenew ?? false,
        paymentTerms: (input.paymentTerms ?? {}) as Prisma.InputJsonValue,
        requiredDocs: input.requiredDocs ?? [],
        registrationRequired: input.registrationRequired ?? false,
        ownerId: input.ownerId ?? ctx.userId,
        status: 'DRAFT',
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'contract.create',
        objectType: 'contract',
        objectId: created.id,
        after: { number: created.number, subject: created.subject, status: created.status },
      },
    };
  });
}

export async function updateContract(ctx: TenantContext, id: string, input: Partial<ContractInput>) {
  requirePermission(ctx, 'contract.edit');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.contract, ctx, id);
    if (!['DRAFT', 'IN_REVIEW'].includes(before.status)) {
      throw new ValidationError('CONTRACT_NOT_EDITABLE', `Статус ${before.status}: правки только через amendment`);
    }
    const after = await tx.contract.update({
      where: { id },
      data: {
        ...(input.number !== undefined ? { number: input.number } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.limitMinor !== undefined ? { limitMinor: input.limitMinor } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
        ...(input.autoRenew !== undefined ? { autoRenew: input.autoRenew } : {}),
        ...(input.paymentTerms !== undefined
          ? { paymentTerms: input.paymentTerms as Prisma.InputJsonValue }
          : {}),
        ...(input.requiredDocs !== undefined ? { requiredDocs: input.requiredDocs } : {}),
        ...(input.registrationRequired !== undefined ? { registrationRequired: input.registrationRequired } : {}),
        updatedBy: ctx.userId,
      },
    });
    return {
      result: after,
      audit: {
        action: 'contract.update',
        objectType: 'contract',
        objectId: id,
        before: { number: before.number, subject: before.subject, limitMinor: before.limitMinor?.toString() },
        after: { number: after.number, subject: after.subject, limitMinor: after.limitMinor?.toString() },
      },
    };
  });
}

/** Переход по state machine (docs/04) c audit; renew принимает новую дату окончания. */
export async function transitionContract(
  ctx: TenantContext,
  id: string,
  trigger: ContractTrigger,
  options?: { newEndDate?: Date },
) {
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const contract = await findScopedOr404(tx.contract, ctx, id);
    const balance = await getContractBalanceInternal(tx, ctx.tenantId, id);
    const openTasks = await tx.task.count({
      where: { tenantId: ctx.tenantId, objectType: 'contract', objectId: id, status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] } },
    });
    const to = contractMachine.assert(ctx, contract.status as CoreContractStatus, trigger, {
      registrationRequired: contract.registrationRequired,
      outstandingMinor: balance.outstandingMinor,
      openTasks,
    });
    const after = await tx.contract.update({
      where: { id },
      data: {
        status: to as ContractStatus,
        ...(trigger === 'register' ? { registeredAt: new Date() } : {}),
        ...(trigger === 'renew' && options?.newEndDate ? { endDate: options.newEndDate } : {}),
        updatedBy: ctx.userId,
      },
    });
    return {
      result: after,
      audit: {
        action: `contract.${trigger}`,
        objectType: 'contract',
        objectId: id,
        before: { status: contract.status },
        after: { status: to },
      },
    };
  });
}

// ── Amendments ──

export async function createAmendment(
  ctx: TenantContext,
  contractId: string,
  input: { number: string; date: Date; changes?: Record<string, unknown> },
) {
  requirePermission(ctx, 'contract.edit');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const contract = await findScopedOr404(tx.contract, ctx, contractId);
    if (contract.status !== 'AMENDING') {
      throw new ValidationError('CONTRACT_NOT_AMENDING', 'Сначала переведите договор в AMENDING (start_amend)');
    }
    const created = await tx.contractAmendment.create({
      data: {
        tenantId: ctx.tenantId,
        contractId,
        number: input.number,
        date: input.date,
        changes: (input.changes ?? {}) as Prisma.InputJsonValue,
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'contract.amendment.create',
        objectType: 'contract_amendment',
        objectId: created.id,
        after: { number: created.number, contractId },
      },
    };
  });
}

/** Подписание amendment: применяет changes (limit/endDate) и возвращает договор в ACTIVE. */
export async function signAmendment(ctx: TenantContext, amendmentId: string) {
  requirePermission(ctx, 'contract.approve');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const amendment = await findScopedOr404(tx.contractAmendment, ctx, amendmentId);
    if (amendment.status === 'SIGNED') throw new ValidationError('AMENDMENT_ALREADY_SIGNED');
    const contract = await tx.contract.findUniqueOrThrow({ where: { id: amendment.contractId } });
    const changes = amendment.changes as { limitMinor?: string; endDate?: string };
    await tx.contractAmendment.update({ where: { id: amendmentId }, data: { status: 'SIGNED' } });
    const to = contractMachine.assert(ctx, contract.status as CoreContractStatus, 'amendment_signed', {
      registrationRequired: contract.registrationRequired,
    });
    const after = await tx.contract.update({
      where: { id: contract.id },
      data: {
        status: to as ContractStatus,
        ...(changes.limitMinor ? { limitMinor: BigInt(changes.limitMinor) } : {}),
        ...(changes.endDate ? { endDate: new Date(changes.endDate) } : {}),
        updatedBy: ctx.userId,
      },
    });
    return {
      result: after,
      audit: {
        action: 'contract.amendment.sign',
        objectType: 'contract_amendment',
        objectId: amendmentId,
        after: { contractId: contract.id, changes },
      },
    };
  });
}

// ── Баланс (интерфейс v_contract_balance) ──

export interface ContractBalance {
  committedMinor: bigint;
  paidMinor: bigint;
  outstandingMinor: bigint;
  requestedPendingMinor: bigint;
}

async function getContractBalanceInternal(
  tx: Prisma.TransactionClient,
  _tenantId: string,
  contractId: string,
): Promise<ContractBalance> {
  const contract = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  // Phase C-01 добавит: paid из PaymentRequest PAID, requested_pending из
  // SUBMITTED…SENT_TO_BANK (BR-011), committed из approved PR + pending PAY.
  const committed = 0n;
  const paid = 0n;
  const requestedPending = 0n;
  const limit = contract.limitMinor ?? 0n;
  return {
    committedMinor: committed,
    paidMinor: paid,
    requestedPendingMinor: requestedPending,
    outstandingMinor: limit > 0n ? limit - paid - requestedPending : 0n,
  };
}

export async function getContractBalance(ctx: TenantContext, contractId: string): Promise<ContractBalance> {
  requirePermission(ctx, 'contract.view');
  await findScopedOr404(prisma.contract, ctx, contractId);
  return prisma.$transaction((tx) => getContractBalanceInternal(tx, ctx.tenantId, contractId));
}

// ── Чтение ──

export async function listContracts(ctx: TenantContext, filter?: { status?: ContractStatus }) {
  requirePermission(ctx, 'contract.view');
  return prisma.contract.findMany({
    where: whereTenant(ctx, filter?.status ? { status: filter.status } : {}),
    include: { vendor: { select: { displayName: true } }, customer: { select: { legalName: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getContract360(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'contract.view');
  const contract = await findScopedOr404(prisma.contract, ctx, id);
  const [amendments, balance, vendor, customer] = await Promise.all([
    prisma.contractAmendment.findMany({ where: { contractId: id }, orderBy: { date: 'desc' } }),
    getContractBalance(ctx, id),
    contract.vendorId ? prisma.vendor.findUnique({ where: { id: contract.vendorId } }) : null,
    contract.customerId ? prisma.customer.findUnique({ where: { id: contract.customerId } }) : null,
  ]);
  return { contract, amendments, balance, vendor, customer };
}

/** BR-026 (заглушка для D-05 job): Task за 30 дней до end_date. */
export async function createExpiryTasksForTenant(tenantId: string, today = new Date()): Promise<number> {
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 30);
  const expiring = await prisma.contract.findMany({
    where: { tenantId, status: 'ACTIVE', endDate: { not: null, lte: soon, gte: today } },
  });
  let created = 0;
  for (const contract of expiring) {
    const exists = await prisma.task.count({
      where: { tenantId, type: 'CONTRACT_EXPIRY', objectId: contract.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    });
    if (exists === 0) {
      await prisma.task.create({
        data: {
          tenantId,
          type: 'CONTRACT_EXPIRY',
          objectType: 'contract',
          objectId: contract.id,
          ownerId: contract.ownerId,
          dueAt: contract.endDate,
          nextAction: `Договор ${contract.number} истекает ${contract.endDate?.toISOString().slice(0, 10)}: продлить (renew) или запустить terminate`,
        },
      });
      created++;
    }
  }
  return created;
}
