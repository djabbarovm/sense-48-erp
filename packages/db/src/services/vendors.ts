/**
 * B-01: Vendor + VendorBankAccount workflow (docs/04 state machines,
 * BR-030…BR-034, docs/05 права).
 */
import type { TenantContext } from '@finance-os/core';
import {
  NotFoundError,
  ValidationError,
  assertValidAccountNumber,
  decryptSecret,
  encryptSecret,
  hasRole,
  maskAccount,
  requirePermission,
} from '@finance-os/core';
import type { VendorStatus, VerificationMethod } from '@prisma/client';
import { withAudit, writeAudit } from '../audit.js';
import { prisma } from '../client.js';
import { findScopedOr404, whereTenant } from '../repository.js';

export const RISK_NEW = 'NEW';
export const RISK_BANK_CHANGED = 'BANK_CHANGED_RECENTLY';
export const RISK_RELATED_PARTY = 'RELATED_PARTY';

function bankDataKey(): string {
  const key = process.env.BANK_DATA_KEY;
  if (!key) throw new ValidationError('BANK_DATA_KEY_MISSING', 'BANK_DATA_KEY env is required');
  return key;
}

export interface VendorInput {
  taxId: string;
  legalName: string;
  displayName?: string;
  categoryDefaultId?: string | null;
  vatPayer?: boolean;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  requiresContract?: boolean;
  relatedParty?: boolean;
  businessOwnerId?: string | null;
  notes?: string | null;
}

function assertTaxId(taxId: string): void {
  if (!/^\d{9}$/.test(taxId)) throw new ValidationError('TAX_ID_INVALID', 'ИНН — 9 цифр');
}

/** BR-034: активный vendor с тем же ИНН в tenant → ошибка со ссылкой на существующего. */
async function assertTaxIdUnique(ctx: TenantContext, taxId: string, exceptId?: string) {
  const existing = await prisma.vendor.findFirst({
    where: whereTenant(ctx, { taxId, status: { not: 'BLOCKED' as VendorStatus }, ...(exceptId ? { id: { not: exceptId } } : {}) }),
  });
  if (existing) {
    throw new ValidationError('VENDOR_TAX_ID_EXISTS', `Vendor с ИНН ${taxId} уже существует: ${existing.id}`);
  }
}

export async function createVendor(ctx: TenantContext, input: VendorInput) {
  requirePermission(ctx, 'vendor.create');
  assertTaxId(input.taxId);
  await assertTaxIdUnique(ctx, input.taxId);
  // REQUESTER создаёт только PENDING_VERIFICATION (docs/05); финансовые роли — тоже,
  // активация идёт через verify (state machine Vendor)
  const riskFlags = [RISK_NEW, ...(input.relatedParty ? [RISK_RELATED_PARTY] : [])];
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const created = await tx.vendor.create({
      data: {
        tenantId: ctx.tenantId,
        taxId: input.taxId,
        legalName: input.legalName,
        displayName: input.displayName ?? input.legalName,
        categoryDefaultId: input.categoryDefaultId ?? null,
        vatPayer: input.vatPayer ?? false,
        status: 'PENDING_VERIFICATION',
        riskFlags,
        contactName: input.contactName ?? null,
        contactPhone: input.contactPhone ?? null,
        contactEmail: input.contactEmail ?? null,
        requiresContract: input.requiresContract ?? false,
        businessOwnerId: input.businessOwnerId ?? null,
        notes: input.notes ?? null,
        createdBy: ctx.userId,
      },
    });
    return {
      result: created,
      audit: {
        action: 'vendor.create',
        objectType: 'vendor',
        objectId: created.id,
        after: { taxId: created.taxId, legalName: created.legalName, status: created.status, riskFlags },
      },
    };
  });
}

export async function updateVendor(ctx: TenantContext, id: string, input: Partial<VendorInput>) {
  requirePermission(ctx, 'vendor.edit');
  if (input.taxId) assertTaxId(input.taxId);
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const before = await findScopedOr404(tx.vendor, ctx, id);
    if (input.taxId && input.taxId !== before.taxId) await assertTaxIdUnique(ctx, input.taxId, id);
    const after = await tx.vendor.update({
      where: { id },
      data: {
        ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.categoryDefaultId !== undefined ? { categoryDefaultId: input.categoryDefaultId } : {}),
        ...(input.vatPayer !== undefined ? { vatPayer: input.vatPayer } : {}),
        ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        ...(input.requiresContract !== undefined ? { requiresContract: input.requiresContract } : {}),
        ...(input.businessOwnerId !== undefined ? { businessOwnerId: input.businessOwnerId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedBy: ctx.userId,
      },
    });
    return {
      result: after,
      audit: {
        action: 'vendor.update',
        objectType: 'vendor',
        objectId: id,
        before: { taxId: before.taxId, legalName: before.legalName, requiresContract: before.requiresContract },
        after: { taxId: after.taxId, legalName: after.legalName, requiresContract: after.requiresContract },
      },
    };
  });
}

/** State machine Vendor: verify [LEAD, второй ≠ создатель] → ACTIVE. */
export async function verifyVendor(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'vendor.block'); // активация — уровень LEAD/OWNER (docs/04 verify [LEAD])
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const vendor = await findScopedOr404(tx.vendor, ctx, id);
    if (vendor.status !== 'PENDING_VERIFICATION') {
      throw new ValidationError('VENDOR_NOT_PENDING', `Vendor status is ${vendor.status}`);
    }
    if (vendor.createdBy && vendor.createdBy === ctx.userId) {
      throw new ValidationError('SOD_VIOLATION', 'Верифицировать vendor должен другой сотрудник (docs/04)');
    }
    const hasVerifiedAccount = await tx.vendorBankAccount.count({
      where: { vendorId: id, status: 'VERIFIED' },
    });
    if (hasVerifiedAccount === 0) {
      throw new ValidationError('VENDOR_NO_VERIFIED_BANK', 'Нужен VERIFIED банковский счёт');
    }
    const after = await tx.vendor.update({ where: { id }, data: { status: 'ACTIVE', updatedBy: ctx.userId } });
    return {
      result: after,
      audit: {
        action: 'vendor.verify',
        objectType: 'vendor',
        objectId: id,
        before: { status: vendor.status },
        after: { status: after.status },
      },
    };
  });
}

export async function blockVendor(ctx: TenantContext, id: string, reason: string) {
  requirePermission(ctx, 'vendor.block');
  if (!reason || reason.trim().length < 3) throw new ValidationError('REASON_REQUIRED');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const vendor = await findScopedOr404(tx.vendor, ctx, id);
    if (vendor.status === 'BLOCKED') throw new ValidationError('VENDOR_ALREADY_BLOCKED');
    const after = await tx.vendor.update({ where: { id }, data: { status: 'BLOCKED', updatedBy: ctx.userId } });
    // docs/04: все pending PaymentRequest → ON_HOLD (реализуется в Phase C, когда появится PaymentRequest)
    return {
      result: after,
      audit: {
        action: 'vendor.block',
        objectType: 'vendor',
        objectId: id,
        before: { status: vendor.status },
        after: { status: 'BLOCKED', reason },
      },
    };
  });
}

/** Unblock — только OWNER (docs/04). */
export async function unblockVendor(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'vendor.block');
  if (!hasRole(ctx, 'OWNER')) throw new ValidationError('OWNER_ONLY', 'Разблокировка — только Owner (docs/04)');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const vendor = await findScopedOr404(tx.vendor, ctx, id);
    if (vendor.status !== 'BLOCKED') throw new ValidationError('VENDOR_NOT_BLOCKED');
    const after = await tx.vendor.update({ where: { id }, data: { status: 'ACTIVE', updatedBy: ctx.userId } });
    return {
      result: after,
      audit: {
        action: 'vendor.unblock',
        objectType: 'vendor',
        objectId: id,
        before: { status: 'BLOCKED' },
        after: { status: 'ACTIVE' },
      },
    };
  });
}

// ── Bank accounts (BR-030/031/032) ──

export interface BankAccountInput {
  bankName: string;
  mfo: string;
  account: string; // полный номер, будет зашифрован
  currency?: string;
}

/**
 * BR-030: создание/смена реквизитов → всегда новая запись UNVERIFIED,
 * прежняя default RETIRED, vendor получает risk flag BANK_CHANGED_RECENTLY,
 * создаётся Task VERIFY_BANK.
 */
export async function changeBankAccount(ctx: TenantContext, vendorId: string, input: BankAccountInput) {
  requirePermission(ctx, 'vendor.bank.change');
  assertValidAccountNumber(input.account);
  if (!/^\d{5}$/.test(input.mfo)) throw new ValidationError('MFO_INVALID', 'МФО — 5 цифр');
  const key = bankDataKey();
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const vendor = await findScopedOr404(tx.vendor, ctx, vendorId);
    const currency = input.currency ?? 'UZS';
    const previous = await tx.vendorBankAccount.findMany({
      where: { vendorId, currency, status: { not: 'RETIRED' } },
    });
    for (const acc of previous) {
      await tx.vendorBankAccount.update({ where: { id: acc.id }, data: { status: 'RETIRED', isDefault: false } });
    }
    const created = await tx.vendorBankAccount.create({
      data: {
        tenantId: ctx.tenantId,
        vendorId,
        bankName: input.bankName,
        mfo: input.mfo,
        accountMasked: maskAccount(input.account),
        accountEncrypted: encryptSecret(input.account, key),
        currency,
        status: 'UNVERIFIED',
        isDefault: false,
        createdBy: ctx.userId,
      },
    });
    const hadAccounts = previous.length > 0;
    if (hadAccounts && !vendor.riskFlags.includes(RISK_BANK_CHANGED)) {
      await tx.vendor.update({
        where: { id: vendorId },
        data: { riskFlags: [...vendor.riskFlags, RISK_BANK_CHANGED] },
      });
    }
    const task = await tx.task.create({
      data: {
        tenantId: ctx.tenantId,
        type: 'VERIFY_BANK',
        objectType: 'vendor_bank_account',
        objectId: created.id,
        nextAction: `Проверить реквизиты ${vendor.displayName} (${maskAccount(input.account)}) по verified-каналу и провести dual verify`,
        createdBy: ctx.userId,
      },
    });
    return {
      result: { account: created, task },
      audit: [
        {
          action: 'vendor.bank_account.change',
          objectType: 'vendor_bank_account',
          objectId: created.id,
          before: hadAccounts ? { retired: previous.map((p) => p.accountMasked) } : null,
          after: { accountMasked: created.accountMasked, bankName: created.bankName, mfo: created.mfo, status: 'UNVERIFIED' },
        },
      ],
    };
  });
}

/** BR-032 шаг 1: фиксирует метод проверки; статус остаётся UNVERIFIED. */
export async function verifyBankStep1(
  ctx: TenantContext,
  accountId: string,
  method: VerificationMethod,
) {
  requirePermission(ctx, 'vendor.bank.verify_step1');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const account = await findScopedOr404(tx.vendorBankAccount, ctx, accountId);
    if (account.status !== 'UNVERIFIED') throw new ValidationError('ACCOUNT_NOT_UNVERIFIED');
    const after = await tx.vendorBankAccount.update({
      where: { id: accountId },
      data: { verifyStep1By: ctx.userId, verifyStep1At: new Date(), verificationMethod: method },
    });
    return {
      result: after,
      audit: {
        action: 'vendor.bank_account.verify_step1',
        objectType: 'vendor_bank_account',
        objectId: accountId,
        after: { method, by: ctx.userId },
      },
    };
  });
}

/** BR-032 шаг 2: другой пользователь → VERIFIED (+default), Task закрывается. */
export async function verifyBankStep2(ctx: TenantContext, accountId: string) {
  requirePermission(ctx, 'vendor.bank.verify_step2');
  return withAudit({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const account = await findScopedOr404(tx.vendorBankAccount, ctx, accountId);
    if (account.status !== 'UNVERIFIED') throw new ValidationError('ACCOUNT_NOT_UNVERIFIED');
    if (!account.verifyStep1By) throw new ValidationError('VERIFY_STEP1_REQUIRED');
    if (account.verifyStep1By === ctx.userId) {
      throw new ValidationError('SOD_VIOLATION', 'Второй шаг верификации должен выполнить другой пользователь (BR-032)');
    }
    const after = await tx.vendorBankAccount.update({
      where: { id: accountId },
      data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedBy: ctx.userId, isDefault: true },
    });
    await tx.task.updateMany({
      where: {
        tenantId: ctx.tenantId,
        type: 'VERIFY_BANK',
        objectId: accountId,
        status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] },
      },
      data: { status: 'DONE' },
    });
    return {
      result: after,
      audit: {
        action: 'vendor.bank_account.verify_step2',
        objectType: 'vendor_bank_account',
        objectId: accountId,
        before: { status: 'UNVERIFIED' },
        after: { status: 'VERIFIED', by: ctx.userId },
      },
    };
  });
}

/** BR-074: полный номер счёта — только с правом vendor.bank.reveal, с audit-записью. */
export async function revealBankAccount(ctx: TenantContext, accountId: string): Promise<string> {
  requirePermission(ctx, 'vendor.bank.reveal');
  const account = await findScopedOr404(prisma.vendorBankAccount, ctx, accountId);
  let full: string;
  try {
    full = decryptSecret(account.accountEncrypted, bankDataKey());
  } catch {
    throw new ValidationError('DECRYPT_FAILED');
  }
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, {
      action: 'vendor.bank_account.reveal',
      objectType: 'vendor_bank_account',
      objectId: accountId,
      after: { accountMasked: account.accountMasked },
    });
  });
  return full;
}


export async function listVendors(ctx: TenantContext, filter?: { status?: VendorStatus; search?: string }) {
  requirePermission(ctx, 'vendor.view');
  return prisma.vendor.findMany({
    where: whereTenant(ctx, {
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.search
        ? {
            OR: [
              { displayName: { contains: filter.search, mode: 'insensitive' as const } },
              { legalName: { contains: filter.search, mode: 'insensitive' as const } },
              { taxId: { contains: filter.search } },
            ],
          }
        : {}),
    }),
    orderBy: { displayName: 'asc' },
  });
}

export async function getVendor360(ctx: TenantContext, id: string) {
  requirePermission(ctx, 'vendor.view');
  const vendor = await findScopedOr404(prisma.vendor, ctx, id);
  const [bankAccounts, contracts, tasks] = await Promise.all([
    prisma.vendorBankAccount.findMany({ where: { vendorId: id }, orderBy: { createdAt: 'desc' } }),
    prisma.contract.findMany({ where: { vendorId: id }, orderBy: { startDate: 'desc' } }),
    prisma.task.findMany({
      where: { tenantId: ctx.tenantId, objectType: 'vendor_bank_account', status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const accountIds = new Set(bankAccounts.map((a) => a.id));
  return {
    vendor,
    bankAccounts: bankAccounts.map(({ accountEncrypted: _enc, ...rest }) => rest),
    contracts,
    tasks: tasks.filter((t) => accountIds.has(t.objectId)),
  };
}

/** Если vendor не найден в tenant — 404 (используется другими сервисами). */
export async function getVendorOr404(ctx: TenantContext, id: string) {
  const vendor = await prisma.vendor.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!vendor) throw new NotFoundError();
  return vendor;
}
