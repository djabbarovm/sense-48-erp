'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NotFoundError, PermissionDeniedError, ValidationError } from '@finance-os/core';
import { markBonusesPaid } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function markBonusesPaidAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const period = String(formData.get('period') ?? '').trim();
  const ids = formData.getAll('ids').map(String).filter(Boolean);
  const back = `/bonuses?period=${encodeURIComponent(period)}`;
  let error: string | null = null;
  try {
    if (ids.length === 0) throw new ValidationError('BONUS_NOT_PAYABLE');
    await markBonusesPaid(ctx, ids, period, String(formData.get('ref') ?? '').trim() || null);
  } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError) error = e.code;
    else if (e instanceof NotFoundError) error = 'NOT_FOUND';
    else throw e;
  }
  revalidatePath('/bonuses');
  redirect(`${back}${error ? `&error=${encodeURIComponent(error)}` : ''}`);
}
