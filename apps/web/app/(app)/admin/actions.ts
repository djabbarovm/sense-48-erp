'use server';

import { revalidatePath } from 'next/cache';
import type { CategoryGroup, RoleCode } from '@finance-os/db';
import {
  grantRole,
  revokeRole,
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
