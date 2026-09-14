/** B-03: Customer CRUD (минимум, docs/02 §2). */
import type { TenantContext } from '@finance-os/core';
import { ValidationError, requirePermission } from '@finance-os/core';
import type { CustomerStatus } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';

export interface CustomerInput {
  legalName: string;
  taxId?: string | null;
  creditLimitMinor?: bigint | null;
  paymentTermsDays?: number;
  arOwnerId?: string | null;
}

export async function createCustomer(ctx: TenantContext, input: CustomerInput) {
  requirePermission(ctx, 'customer.create');
  if (!input.legalName.trim()) throw new ValidationError('REQUIRED_FIELDS');
  if (input.taxId && !/^\d{9}$/.test(input.taxId)) throw new ValidationError('TAX_ID_INVALID');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const created = await tx.customer.create({
      data: {
        tenantId: ctx.tenantId,
        legalName: input.legalName,
        taxId: input.taxId ?? null,
        creditLimitMinor: input.creditLimitMinor ?? null,
        paymentTermsDays: input.paymentTermsDays ?? 0,
        arOwnerId: input.arOwnerId ?? null,
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'customer.create',
        objectType: 'customer',
        objectId: created.id,
        after: { legalName: created.legalName, taxId: created.taxId },
      },
    };
  });
}

export async function updateCustomer(ctx: TenantContext, id: string, input: Partial<CustomerInput> & { status?: CustomerStatus }) {
  requirePermission(ctx, 'customer.edit');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.customer, ctx, id);
    const after = await tx.customer.update({
      where: { id },
      data: {
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
        ...(input.creditLimitMinor !== undefined ? { creditLimitMinor: input.creditLimitMinor } : {}),
        ...(input.paymentTermsDays !== undefined ? { paymentTermsDays: input.paymentTermsDays } : {}),
        ...(input.arOwnerId !== undefined ? { arOwnerId: input.arOwnerId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedBy: ctx.userId,
      },
    });
    return {
      result: after,
      audit: {
        action: 'customer.update',
        objectType: 'customer',
        objectId: id,
        before: { legalName: before.legalName, status: before.status },
        after: { legalName: after.legalName, status: after.status },
      },
    };
  });
}

export async function listCustomers(ctx: TenantContext) {
  requirePermission(ctx, 'customer.view');
  return prisma.customer.findMany({ where: whereTenant(ctx), orderBy: { legalName: 'asc' } });
}
