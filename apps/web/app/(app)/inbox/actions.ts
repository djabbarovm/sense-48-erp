'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NotFoundError, PermissionDeniedError, ValidationError, IllegalTransitionError } from '@finance-os/core';
import { handoffDeal } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

/** Slice 2: колл-центр передаёт квалифицированную сделку брокеру (docs/23 §9). */
export async function handoffAction(fd: FormData): Promise<never> {
  const dealId = String(fd.get('dealId') ?? '');
  const back = String(fd.get('back') ?? '/inbox');
  const ctx = await requireTenantContext();
  let error: string | null = null;
  try {
    await handoffDeal(ctx, dealId);
  } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError || e instanceof IllegalTransitionError) error = e.code;
    else if (e instanceof NotFoundError) error = 'NOT_FOUND';
    else throw e;
  }
  revalidatePath('/inbox');
  revalidatePath('/deals');
  redirect(`${back}${error ? `?error=${encodeURIComponent(error)}` : ''}`);
}
