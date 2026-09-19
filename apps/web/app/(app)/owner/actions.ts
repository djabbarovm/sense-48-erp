'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { DocType, WorkOrderCategory } from '@finance-os/db';
import { NotFoundError, PermissionDeniedError, ValidationError } from '@finance-os/core';
import { createStorageFromEnv } from '@finance-os/adapters';
import { createOwnerRequest, createOwnerServiceOrder, rateOwnerServiceOrder, updateOwnerConsents, uploadOwnerDocument } from '@finance-os/db';
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

export async function uploadOwnerDocumentAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const file = formData.get('file');
  const [objectType, objectId] = String(formData.get('object') ?? '').split(':');
  await run(async () => {
    if (!(file instanceof File) || file.size === 0) throw new ValidationError('FILE_EMPTY');
    if ((objectType !== 'unit' && objectType !== 'lease_contract') || !objectId) throw new ValidationError('LOCATION_REQUIRED');
    await uploadOwnerDocument(ctx, createStorageFromEnv(), { objectType, objectId, docType: String(formData.get('docType') ?? 'OTHER') as DocType, fileName: file.name, mime: file.type, body: Buffer.from(await file.arrayBuffer()) });
  });
}

export async function createOwnerServiceOrderAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const when = String(formData.get('scheduledAt') ?? '').trim();
  await run(() => createOwnerServiceOrder(ctx, { catalogItemId: String(formData.get('catalogItemId') ?? ''), unitId: String(formData.get('unitId') ?? ''), quantity: Number(formData.get('quantity') ?? '1'), notes: String(formData.get('notes') ?? '').trim() || null, scheduledAt: when ? new Date(when) : null }).then(() => undefined));
}

export async function rateOwnerServiceOrderAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(() => rateOwnerServiceOrder(ctx, String(formData.get('id') ?? ''), Number(formData.get('rating') ?? '0'), String(formData.get('comment') ?? '').trim() || null).then(() => undefined));
}
