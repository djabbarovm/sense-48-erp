'use server';

import { revalidatePath } from 'next/cache';
import { TrustbankXlsxParser, UnifiedCsvParser } from '@finance-os/adapters';
import type { BankImportReport } from '@finance-os/db';
import { ignoreTransaction, importBankStatement, manualMatch, markPaymentFailed } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export interface ImportState {
  report?: BankImportReport;
  error?: string;
}

/** Формат по расширению: .csv → Unified (docs/07 §1), .xlsx → Trustbank Клиент-Банк. */
export async function importStatementAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const ctx = await requireTenantContext();
  const file = formData.get('file');
  const bankAccountId = String(formData.get('bankAccountId') ?? '');
  if (!(file instanceof File) || file.size === 0) return { error: 'NO_FILE' };
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parser = file.name.toLowerCase().endsWith('.xlsx') ? new TrustbankXlsxParser() : new UnifiedCsvParser();
    const rows = parser.parse(buffer);
    const report = await importBankStatement(ctx, bankAccountId, rows);
    revalidatePath('/bank');
    return { report };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function manualMatchAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await manualMatch(ctx, String(formData.get('transactionId')), String(formData.get('paymentId')));
  revalidatePath('/bank');
  revalidatePath('/payments');
}

export async function ignoreTxAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await ignoreTransaction(ctx, String(formData.get('transactionId')), String(formData.get('reason') ?? ''));
  revalidatePath('/bank');
}

export async function markFailedAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await markPaymentFailed(ctx, String(formData.get('paymentId')), String(formData.get('reason') ?? ''));
  revalidatePath('/bank');
  revalidatePath('/payments');
}
