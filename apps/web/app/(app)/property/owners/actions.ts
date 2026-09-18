'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PermissionDeniedError, ValidationError } from '@finance-os/core';
import { linkOwnerUser } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function linkOwnerUserAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  let error: string | null = null;
  try {
    const email = String(formData.get('email') ?? '').trim();
    await linkOwnerUser(ctx, String(formData.get('ownerId')), formData.get('unlink') === '1' ? null : email);
  } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError) error = e.code;
    else throw e;
  }
  revalidatePath('/property/owners');
  redirect(`/property/owners${error ? `?error=${encodeURIComponent(error)}` : ''}`);
}
