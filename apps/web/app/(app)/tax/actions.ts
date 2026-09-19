'use server';

import { revalidatePath } from 'next/cache';
import type { TaxType } from '@finance-os/db';
import {
  approveTaxObligation,
  calculateTaxObligation,
  createTaxPayment,
  fileTaxObligation,
  generateTaxObligations,
  upsertTaxRule,
  applyTaxPreset,
} from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

const soumToMinor = (value: FormDataEntryValue | null) => BigInt(String(value ?? '0').replace(/\s/g, '') || '0') * 100n;

export async function upsertTaxRuleAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const min = soumToMinor(formData.get('expectedMin'));
  const max = soumToMinor(formData.get('expectedMax'));
  await upsertTaxRule(ctx, {
    type: String(formData.get('type')) as TaxType,
    name: String(formData.get('name') ?? ''),
    recurrence: (String(formData.get('recurrence') ?? 'MONTHLY') || 'MONTHLY') as 'MONTHLY',
    dueDay: Number(formData.get('dueDay') ?? 20),
    expectedMinMinor: min > 0n ? min : null,
    expectedMaxMinor: max > 0n ? max : null,
    rateBp: String(formData.get('ratePct') ?? '').trim() ? Math.round(Number(formData.get('ratePct')) * 100) : null,
    baseKind: (String(formData.get('baseKind') ?? '') || null) as 'TURNOVER' | 'PAYROLL' | null,
    note: String(formData.get('note') ?? '').trim() || null,
  });
  await generateTaxObligations(ctx.tenantId);
  revalidatePath('/tax');
}

/** H-10: пресет режима (налог c оборота 4% + зарплатные налоги) — правила + обязательства. */
export async function applyTaxPresetAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await applyTaxPreset(ctx, String(formData.get('preset') ?? ''));
  await generateTaxObligations(ctx.tenantId);
  revalidatePath('/tax');
}

export async function calculateTaxAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await calculateTaxObligation(ctx, String(formData.get('id')), soumToMinor(formData.get('amount')));
  revalidatePath('/tax');
}

export async function approveTaxAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await approveTaxObligation(ctx, String(formData.get('id')));
  revalidatePath('/tax');
}

export async function createTaxPaymentAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await createTaxPayment(ctx, String(formData.get('id')));
  revalidatePath('/tax');
  revalidatePath('/payments');
}

export async function fileTaxAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await fileTaxObligation(ctx, String(formData.get('id')));
  revalidatePath('/tax');
}
