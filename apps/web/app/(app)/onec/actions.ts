'use server';

import { revalidatePath } from 'next/cache';
import type { PostedReport } from '@finance-os/db';
import { importPostedStatus, parsePostedCsv, upsertAccountMapping } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export interface PostedState {
  report?: PostedReport;
  error?: string;
}

export async function importPostedAction(_prev: PostedState, formData: FormData): Promise<PostedState> {
  const ctx = await requireTenantContext();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'NO_FILE' };
  try {
    const rows = parsePostedCsv(Buffer.from(await file.arrayBuffer()).toString('utf8'));
    const report = await importPostedStatus(ctx, rows);
    revalidatePath('/onec');
    revalidatePath('/payments');
    return { report };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function upsertMappingAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const vat = String(formData.get('vatAccountCode') ?? '').trim();
  await upsertAccountMapping(ctx, {
    categoryId: String(formData.get('categoryId')),
    accountCode: String(formData.get('accountCode') ?? '').trim(),
    vatAccountCode: vat || null,
  });
  revalidatePath('/onec');
}
