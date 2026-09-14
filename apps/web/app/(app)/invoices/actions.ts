'use server';

import { revalidatePath } from 'next/cache';
import { MockEdoAdapter } from '@finance-os/adapters';
import {
  disputeInvoice,
  importEdoRegistry,
  matchInvoice,
  resolveDuplicate,
  type ImportReport,
} from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function importRegistryAction(
  _prev: ImportReport | null,
  formData: FormData,
): Promise<ImportReport | null> {
  const ctx = await requireTenantContext();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return null;
  const buffer = Buffer.from(await file.arrayBuffer());
  const rows = new MockEdoAdapter().parseRegistry(buffer);
  const report = await importEdoRegistry(ctx, rows);
  revalidatePath('/invoices');
  return report;
}

export async function matchInvoiceAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const prId = String(formData.get('prId') ?? '');
  const contractId = String(formData.get('contractId') ?? '');
  await matchInvoice(ctx, String(formData.get('id')), {
    ...(prId ? { prId } : {}),
    ...(contractId ? { contractId } : {}),
  });
  revalidatePath('/invoices');
}

export async function disputeInvoiceAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await disputeInvoice(ctx, String(formData.get('id')), String(formData.get('reason') ?? ''));
  revalidatePath('/invoices');
}

export async function resolveDuplicateAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await resolveDuplicate(
    ctx,
    String(formData.get('id')),
    String(formData.get('resolution')) as 'NOT_DUPLICATE' | 'CONFIRM_DUPLICATE',
    String(formData.get('reason') ?? '') || undefined,
  );
  revalidatePath('/invoices');
}
