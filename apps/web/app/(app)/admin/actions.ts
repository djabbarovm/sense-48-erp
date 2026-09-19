'use server';

import { revalidatePath } from 'next/cache';
import type { TelephonyProvider } from '@finance-os/adapters';
import type { CategoryGroup, RoleCode, TelephonySettingsInput } from '@finance-os/db';
import {
  createUser,
  grantRole,
  revokeRole,
  updateTelephonySettings,
  updateTenantSettings,
  upsertCategory,
  upsertCostCenter,
} from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function saveTenantSettingsAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await updateTenantSettings(ctx, {
    legalName: String(formData.get('legalName') ?? ''),
    taxId: String(formData.get('taxId') ?? ''),
    vatRateBp: Number(formData.get('vatRateBp') ?? 1200),
    timezone: String(formData.get('timezone') ?? 'Asia/Tashkent'),
    cutoffTime: String(formData.get('cutoffTime') ?? '14:00'),
  });
  revalidatePath('/admin');
}

export async function grantRoleAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await grantRole(ctx, String(formData.get('email') ?? ''), String(formData.get('role')) as RoleCode);
  revalidatePath('/admin');
}

export async function revokeRoleAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await revokeRole(ctx, String(formData.get('userId')), String(formData.get('role')) as RoleCode);
  revalidatePath('/admin');
}

export async function upsertCostCenterAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id') ?? '');
  await upsertCostCenter(ctx, {
    ...(id ? { id } : {}),
    code: String(formData.get('code') ?? ''),
    name: String(formData.get('name') ?? ''),
    isActive: formData.get('isActive') !== 'false',
  });
  revalidatePath('/admin');
}

export async function upsertCategoryAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id') ?? '');
  await upsertCategory(ctx, {
    ...(id ? { id } : {}),
    code: String(formData.get('code') ?? ''),
    name: String(formData.get('name') ?? ''),
    group: String(formData.get('group')) as CategoryGroup,
    closingDocSlaDays: Number(formData.get('closingDocSlaDays') ?? 10),
    accountCode: String(formData.get('accountCode') ?? '') || null,
  });
  revalidatePath('/admin');
}

/** P-29: телефония тенанта — провайдер, зона АТС, внутренние номера (строки «101 = email»), карта полей (JSON). */
export async function saveTelephonySettingsAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const extMap: Record<string, string> = {};
  for (const line of String(formData.get('extMap') ?? '').split(/\r?\n/)) {
    const m = line.match(/^\s*([\d\s-]+?)\s*[=:→]\s*(\S+)\s*$/);
    if (m) extMap[m[1]!.replace(/\D/g, '')] = m[2]!;
  }
  const fieldMapRaw = String(formData.get('fieldMap') ?? '').trim();
  let fieldMap: Record<string, string[]> | null = null;
  if (fieldMapRaw) {
    const parsed = JSON.parse(fieldMapRaw) as Record<string, unknown>;
    fieldMap = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : [String(v)]]));
  }
  await updateTelephonySettings(ctx, {
    provider: String(formData.get('provider') ?? 'generic') as TelephonyProvider,
    tzOffset: String(formData.get('tzOffset') ?? '+05:00').trim(),
    internalExtLen: Number(formData.get('internalExtLen') ?? 4),
    extMap,
    fieldMap: fieldMap as TelephonySettingsInput['fieldMap'],
  });
  revalidatePath('/admin');
}

export async function createUserAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await createUser(ctx, {
    fullName: String(formData.get('fullName') ?? ''),
    username: String(formData.get('username') ?? '') || null,
    email: String(formData.get('newEmail') ?? '') || null,
    role: String(formData.get('newRole')) as RoleCode,
    tempPassword: String(formData.get('tempPassword') ?? ''),
  });
  revalidatePath('/admin');
}
