'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { WorkOrderCategory } from '@finance-os/db';
import { NotFoundError, PermissionDeniedError, ValidationError } from '@finance-os/core';
import { createOwnerRequest, updateOwnerConsents } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

async function run(fn: () => Promise<void>): Promise<never> {
  let error: string | null = null;
  try {
    await fn();
  } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError) error = e.code;
    else if (e instanceof NotFoundError) error = 'NOT_FOUND';
    else throw e;
  }
  revalidatePath('/owner');
  redirect(`/owner${error ? `?error=${encodeURIComponent(error)}` : ''}`);
}

export async function createOwnerRequestAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(() => createOwnerRequest(ctx, { unitId: String(formData.get('unitId') ?? ''), category: String(formData.get('category') ?? 'OTHER') as WorkOrderCategory, title: String(formData.get('title') ?? '').trim(), description: String(formData.get('description') ?? '').trim() || null }).then(() => undefined));
}

export async function updateOwnerConsentsAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(() => updateOwnerConsents(ctx, { managementConsent: formData.get('managementConsent') === 'on', listingConsent: formData.get('listingConsent') === 'on', marketingConsent: formData.get('marketingConsent') === 'on' }).then(() => undefined));
}
