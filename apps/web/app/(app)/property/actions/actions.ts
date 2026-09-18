'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PermissionDeniedError, ValidationError } from '@finance-os/core';
import { confirmActionDraft, createActionDraft, rejectActionDraft } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

async function run(fn: () => Promise<void>): Promise<never> {
  let error: string | null = null;
  try {
    await fn();
  } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError) error = e.code;
    else throw e;
  }
  revalidatePath('/property/actions');
  revalidatePath('/property');
  redirect(`/property/actions${error ? `?error=${encodeURIComponent(error)}` : ''}`);
}

export async function createActionDraftAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(() => createActionDraft(ctx, { text: String(formData.get('text') ?? ''), source: 'WEB' }).then(() => undefined));
}

export async function confirmActionDraftAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(() => confirmActionDraft(ctx, String(formData.get('id'))).then(() => undefined));
}

export async function rejectActionDraftAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(() => rejectActionDraft(ctx, String(formData.get('id')), String(formData.get('reason') ?? '')).then(() => undefined));
}
