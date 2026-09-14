/** B-05: хранение ApprovalPolicy (версионируется, D-12). */
import type { PolicyConfig, TenantContext } from '@finance-os/core';
import { ValidationError, requirePermission } from '@finance-os/core';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';

/** Политика, действующая на дату (BR-041: submitted берёт актуальную на момент submit). */
export async function getActivePolicy(tenantId: string, at: Date = new Date()): Promise<PolicyConfig> {
  const row = await prisma.approvalPolicy.findFirst({
    where: { tenantId, effectiveFrom: { lte: at } },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (row) {
    return {
      tier1MaxMinor: row.tier1MaxMinor,
      tier2MaxMinor: row.tier2MaxMinor,
      unbudgetedRequiresOwner: row.unbudgetedRequiresOwner,
      newVendorOwnerThresholdMinor: row.newVendorOwnerThresholdMinor,
    };
  }
  // D-12 стартовые значения, если Admin ещё не настроил
  return {
    tier1MaxMinor: 500_000_000n, // 5 000 000 UZS в тийинах
    tier2MaxMinor: 2_500_000_000n, // 25 000 000 UZS
    unbudgetedRequiresOwner: true,
    newVendorOwnerThresholdMinor: 0n,
  };
}

/** Новая версия политики (старые строки не меняются — версионирование). */
export async function createPolicyVersion(
  ctx: TenantContext,
  input: Partial<PolicyConfig> & { effectiveFrom?: Date; urgentApproverRoles?: string[] },
) {
  requirePermission(ctx, 'policy.manage');
  const current = await getActivePolicy(ctx.tenantId);
  const tier1 = input.tier1MaxMinor ?? current.tier1MaxMinor;
  const tier2 = input.tier2MaxMinor ?? current.tier2MaxMinor;
  if (tier1 <= 0n || tier2 <= tier1) throw new ValidationError('POLICY_TIERS_INVALID', 'tier2 must be > tier1 > 0');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const created = await tx.approvalPolicy.create({
      data: {
        tenantId: ctx.tenantId,
        tier1MaxMinor: tier1,
        tier2MaxMinor: tier2,
        unbudgetedRequiresOwner: input.unbudgetedRequiresOwner ?? current.unbudgetedRequiresOwner,
        newVendorOwnerThresholdMinor: input.newVendorOwnerThresholdMinor ?? current.newVendorOwnerThresholdMinor,
        ...(input.urgentApproverRoles ? { urgentApproverRoles: input.urgentApproverRoles } : {}),
        effectiveFrom: input.effectiveFrom ?? new Date(),
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'policy.create_version',
        objectType: 'approval_policy',
        objectId: created.id,
        after: {
          tier1MaxMinor: created.tier1MaxMinor.toString(),
          tier2MaxMinor: created.tier2MaxMinor.toString(),
          effectiveFrom: created.effectiveFrom.toISOString(),
        },
      },
    };
  });
}
