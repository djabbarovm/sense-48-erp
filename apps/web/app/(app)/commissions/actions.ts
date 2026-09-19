'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NotFoundError, PermissionDeniedError, ValidationError } from '@finance-os/core';
import { matchCommissionReceipt } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

const str = (fd: FormData, k: string): string | undefined => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : undefined; };
const toMinor = (v: string | undefined): bigint | null => {
  if (v === undefined) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new ValidationError('AMOUNT_INVALID');
  const [whole, frac = ''] = v.split('.');
  return BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'));
};

/** Зачёт поступления в комиссию (BR-P42). */
export async function matchCommissionReceiptAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const back = str(formData, 'back') ?? '/commissions';
  let error: string | null = null;
  try {
    await matchCommissionReceipt(ctx, { bankTransactionId: str(formData, 'bankTransactionId') ?? '', commissionId: str(formData, 'commissionId') ?? '', amountMinor: toMinor(str(formData, 'amount')) });
  } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError) error = e.code;
    else if (e instanceof NotFoundError) error = 'NOT_FOUND';
    else throw e;
  }
  revalidatePath('/commissions'); revalidatePath('/bonuses'); revalidatePath('/deals');
  redirect(`${back}${error ? `${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error)}` : ''}`);
}
