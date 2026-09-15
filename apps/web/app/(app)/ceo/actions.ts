'use server';

import { revalidatePath } from 'next/cache';
import { parseDecimalToMinor } from '@finance-os/core';
import { deleteFixedCost, upsertCostNorm, upsertFixedCost, upsertSenseDay } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function upsertFixedCostAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await upsertFixedCost(ctx, {
    unit: String(formData.get('unit')) as never,
    period: String(formData.get('period')),
    name: String(formData.get('name')).trim(),
    amountMinor: parseDecimalToMinor(String(formData.get('amount'))),
  });
  revalidatePath('/ceo/settings');
  revalidatePath('/ceo');
}

export async function deleteFixedCostAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await deleteFixedCost(ctx, String(formData.get('id')));
  revalidatePath('/ceo/settings');
  revalidatePath('/ceo');
}

export async function upsertCostNormAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await upsertCostNorm(ctx, String(formData.get('format')) as never, Number(formData.get('costPct')));
  revalidatePath('/ceo/settings');
  revalidatePath('/ceo');
}

export async function upsertSenseDayAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const num = (k: string) => { const v = String(formData.get(k) ?? '').trim(); return v ? Number(v) : undefined; };
  await upsertSenseDay(ctx, {
    date: new Date(String(formData.get('date'))),
    revenueMinor: parseDecimalToMinor(String(formData.get('revenue') || '0')),
    ...(num('visitsPlanned') !== undefined ? { visitsPlanned: num('visitsPlanned')! } : {}),
    ...(num('loadPct') !== undefined ? { loadPct: num('loadPct')! } : {}),
    ...(num('cancellations') !== undefined ? { cancellations: num('cancellations')! } : {}),
    ...(num('membershipsSold') !== undefined ? { membershipsSold: num('membershipsSold')! } : {}),
    ...(String(formData.get('notes') ?? '').trim() ? { notes: String(formData.get('notes')).trim() } : {}),
  });
  revalidatePath('/ceo/settings');
  revalidatePath('/ceo');
}
