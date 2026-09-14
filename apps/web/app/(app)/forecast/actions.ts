'use server';

import { revalidatePath } from 'next/cache';
import type { CashPlanType } from '@finance-os/db';
import { deleteCashPlanLine, upsertCashPlanLine } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function upsertPlanLineAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const soum = BigInt(String(formData.get('amount') ?? '0').replace(/\s/g, '') || '0') * 100n;
  const direction = String(formData.get('direction') ?? 'OUT');
  await upsertCashPlanLine(ctx, {
    name: String(formData.get('name') ?? ''),
    type: String(formData.get('type') ?? 'OTHER') as CashPlanType,
    amountMinor: direction === 'OUT' ? -soum : soum,
    dueDate: new Date(String(formData.get('dueDate'))),
    recurrence: formData.get('monthly') === 'on' ? 'MONTHLY' : null,
  });
  revalidatePath('/forecast');
}

export async function deletePlanLineAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await deleteCashPlanLine(ctx, String(formData.get('id')));
  revalidatePath('/forecast');
}
