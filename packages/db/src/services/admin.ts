/**
 * A-12: администрирование tenant (docs/06 §17, права docs/05).
 * Чистые правила — в core (requirePermission); здесь — оркестрация с Prisma + audit.
 */
import type { TenantContext } from '@finance-os/core';
import { NotFoundError, ValidationError, hashPassword, requirePermission } from '@finance-os/core';
import type { CategoryGroup, Prisma, RoleCode } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404 } from '../repository.js';

// ── Tenant settings ──

export interface TenantSettingsInput {
  legalName?: string;
  taxId?: string;
  vatRateBp?: number;
  timezone?: string;
  cutoffTime?: string; // "14:00"
}

export async function updateTenantSettings(ctx: TenantContext, input: TenantSettingsInput) {
  requirePermission(ctx, 'tenant.settings');
  if (input.vatRateBp !== undefined && (input.vatRateBp < 0 || input.vatRateBp > 10000)) {
    throw new ValidationError('VAT_RATE_INVALID');
  }
  if (input.cutoffTime !== undefined && !/^\d{2}:\d{2}$/.test(input.cutoffTime)) {
    throw new ValidationError('CUTOFF_TIME_INVALID');
  }
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.roles.join(',') }, async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const settings = { ...(before.settings as Record<string, unknown>) };
    if (input.cutoffTime !== undefined) settings.cutoff_time = input.cutoffTime;
    const after = await tx.tenant.update({
      where: { id: ctx.tenantId },
      data: {
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
        ...(input.vatRateBp !== undefined ? { vatRateBp: input.vatRateBp } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        settings: settings as Prisma.InputJsonValue,
      },
    });
    return {
      result: after,
      audit: {
        action: 'tenant.settings.update',
        objectType: 'tenant',
        objectId: ctx.tenantId,
        before: { legalName: before.legalName, taxId: before.taxId, vatRateBp: before.vatRateBp, timezone: before.timezone, settings: before.settings },
        after: { legalName: after.legalName, taxId: after.taxId, vatRateBp: after.vatRateBp, timezone: after.timezone, settings: after.settings },
      },
    };
  });
}

// ── Users & roles ──

export async function listTenantUsers(ctx: TenantContext) {
  requirePermission(ctx, 'user.manage');
  const roles = await prisma.userTenantRole.findMany({
    where: { tenantId: ctx.tenantId },
    include: { user: { select: { id: true, email: true, fullName: true, status: true, mfaEnabled: true } } },
    orderBy: { user: { email: 'asc' } },
  });
  const byUser = new Map<string, { user: (typeof roles)[number]['user']; roles: RoleCode[] }>();
  for (const r of roles) {
    const entry = byUser.get(r.userId) ?? { user: r.user, roles: [] };
    entry.roles.push(r.role);
    byUser.set(r.userId, entry);
  }
  return [...byUser.values()];
}

/**
 * P-31: создать сотрудника c системным логином (без email) + временный пароль и роль в текущем тенанте.
 * Для команды Tower без рабочей почты: авторизация по логину, дальше привязка Telegram. Пароль в аудит не пишется.
 */
export interface CreateUserInput { fullName: string; username?: string | null; email?: string | null; role: RoleCode; tempPassword: string }
export async function createUser(ctx: TenantContext, input: CreateUserInput) {
  requirePermission(ctx, 'user.manage');
  const fullName = input.fullName.trim();
  const username = input.username?.trim().toLowerCase().replace(/\s+/g, '') || null;
  const email = input.email?.trim().toLowerCase() || null;
  if (!fullName) throw new ValidationError('REQUIRED_FIELDS');
  if (!username && !email) throw new ValidationError('LOGIN_REQUIRED');
  if (username && !/^[a-z0-9._-]{3,32}$/.test(username)) throw new ValidationError('USERNAME_INVALID');
  if (!input.tempPassword || input.tempPassword.length < 8) throw new ValidationError('PASSWORD_TOO_SHORT');
  if (username && (await prisma.user.findFirst({ where: { username }, select: { id: true } }))) throw new ValidationError('USERNAME_TAKEN');
  if (email && (await prisma.user.findUnique({ where: { email }, select: { id: true } }))) throw new ValidationError('EMAIL_TAKEN');
  const passwordHash = await hashPassword(input.tempPassword);
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const user = await tx.user.create({ data: { fullName, username, email, passwordHash, status: 'ACTIVE' } });
    await tx.userTenantRole.create({ data: { userId: user.id, tenantId: ctx.tenantId, role: input.role } });
    return {
      result: { id: user.id, fullName, username, email, role: input.role },
      audit: { action: 'user.create', objectType: 'user', objectId: user.id, after: { fullName, username, email, role: input.role } },
    };
  });
}

export async function grantRole(ctx: TenantContext, email: string, role: RoleCode) {
  requirePermission(ctx, 'user.manage');
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new NotFoundError('User not found');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const created = await tx.userTenantRole.upsert({
      where: { userId_tenantId_role: { userId: user.id, tenantId: ctx.tenantId, role } },
      create: { userId: user.id, tenantId: ctx.tenantId, role },
      update: {},
    });
    return {
      result: created,
      audit: {
        action: 'user.role.grant',
        objectType: 'user_tenant_role',
        objectId: created.id,
        after: { userId: user.id, email: user.email, role },
      },
    };
  });
}

export async function revokeRole(ctx: TenantContext, userId: string, role: RoleCode) {
  requirePermission(ctx, 'user.manage');
  const existing = await prisma.userTenantRole.findUnique({
    where: { userId_tenantId_role: { userId, tenantId: ctx.tenantId, role } },
  });
  if (!existing) throw new NotFoundError();
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    await tx.userTenantRole.delete({ where: { id: existing.id } });
    return {
      result: null,
      audit: {
        action: 'user.role.revoke',
        objectType: 'user_tenant_role',
        objectId: existing.id,
        before: { userId, role },
      },
    };
  });
}

// ── Cost centers ──

export async function listCostCenters(ctx: TenantContext) {
  // просмотр справочника нужен многим экранам; управление — только ADMIN
  return prisma.costCenter.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { code: 'asc' } });
}

export async function upsertCostCenter(
  ctx: TenantContext,
  input: { id?: string; code: string; name: string; parentId?: string | null; isActive?: boolean; ownerId?: string | null },
) {
  requirePermission(ctx, 'costcenter.manage');
  if (!input.code.trim() || !input.name.trim()) throw new ValidationError('REQUIRED_FIELDS');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    if (input.id) {
      const before = await findScopedOr404(tx.costCenter, ctx, input.id);
      const after = await tx.costCenter.update({
        where: { id: input.id },
        data: {
          code: input.code,
          name: input.name,
          parentId: input.parentId ?? null,
          isActive: input.isActive ?? true,
          ownerId: input.ownerId ?? null,
          updatedBy: ctx.userId,
        },
      });
      return {
        result: after,
        audit: {
          action: 'cost_center.update',
          objectType: 'cost_center',
          objectId: after.id,
          before: { code: before.code, name: before.name, isActive: before.isActive, ownerId: before.ownerId },
          after: { code: after.code, name: after.name, isActive: after.isActive, ownerId: after.ownerId },
        },
      };
    }
    const created = await tx.costCenter.create({
      data: {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name,
        parentId: input.parentId ?? null,
        ownerId: input.ownerId ?? null,
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'cost_center.create',
        objectType: 'cost_center',
        objectId: created.id,
        after: { code: created.code, name: created.name },
      },
    };
  });
}

// ── Categories ──

export async function listCategories(ctx: TenantContext) {
  return prisma.category.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { code: 'asc' } });
}

export async function upsertCategory(
  ctx: TenantContext,
  input: {
    id?: string;
    code: string;
    name: string;
    group: CategoryGroup;
    budgetRequired?: boolean;
    closingDocSlaDays?: number;
    accountCode?: string | null;
    isActive?: boolean;
  },
) {
  requirePermission(ctx, 'category.manage');
  if (!input.code.trim() || !input.name.trim()) throw new ValidationError('REQUIRED_FIELDS');
  if (input.closingDocSlaDays !== undefined && input.closingDocSlaDays < 0) {
    throw new ValidationError('SLA_INVALID');
  }
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    if (input.id) {
      const before = await findScopedOr404(tx.category, ctx, input.id);
      const after = await tx.category.update({
        where: { id: input.id },
        data: {
          code: input.code,
          name: input.name,
          group: input.group,
          budgetRequired: input.budgetRequired ?? before.budgetRequired,
          closingDocSlaDays: input.closingDocSlaDays ?? before.closingDocSlaDays,
          accountCode: input.accountCode ?? before.accountCode,
          isActive: input.isActive ?? before.isActive,
          updatedBy: ctx.userId,
        },
      });
      return {
        result: after,
        audit: {
          action: 'category.update',
          objectType: 'category',
          objectId: after.id,
          before: { code: before.code, name: before.name, group: before.group, closingDocSlaDays: before.closingDocSlaDays, isActive: before.isActive },
          after: { code: after.code, name: after.name, group: after.group, closingDocSlaDays: after.closingDocSlaDays, isActive: after.isActive },
        },
      };
    }
    const created = await tx.category.create({
      data: {
        tenantId: ctx.tenantId,
        code: input.code,
        name: input.name,
        group: input.group,
        budgetRequired: input.budgetRequired ?? false,
        closingDocSlaDays: input.closingDocSlaDays ?? 10,
        accountCode: input.accountCode ?? null,
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'category.create',
        objectType: 'category',
        objectId: created.id,
        after: { code: created.code, name: created.name, group: created.group },
      },
    };
  });
}
