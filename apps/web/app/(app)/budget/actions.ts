'use server';

import { revalidatePath } from 'next/cache';
import { upsertBudgetLine } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function upsertBudgetLineAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const soum = String(formData.get('planned') ?? '0').replace(/\s/g, '');
  await upsertBudgetLine(ctx, {
    period: String(formData.get('period')),
    costCenterId: String(formData.get('costCenterId')),
    categoryId: String(formData.get('categoryId')),
    plannedMinor: BigInt(soum || '0') * 100n,
  });
  revalidatePath('/budget');
}
