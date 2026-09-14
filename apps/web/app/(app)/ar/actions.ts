'use server';

import { revalidatePath } from 'next/cache';
import {
  cancelCustomerInvoice,
  createCustomerInvoice,
  disputeCustomerInvoice,
  issueCustomerInvoice,
  promiseToPay,
} from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function createArInvoiceAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const soum = String(formData.get('amount') ?? '0').replace(/\s/g, '');
  const dueDate = String(formData.get('dueDate') ?? '');
  const created = await createCustomerInvoice(ctx, {
    customerId: String(formData.get('customerId')),
    date: new Date(String(formData.get('date') ?? new Date().toISOString().slice(0, 10))),
    ...(dueDate ? { dueDate: new Date(dueDate) } : {}),
    amountGrossMinor: BigInt(soum || '0') * 100n,
  });
  if (formData.get('issue') === 'on') await issueCustomerInvoice(ctx, created.id);
  revalidatePath('/ar');
}

export async function issueArAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await issueCustomerInvoice(ctx, String(formData.get('id')));
  revalidatePath('/ar');
}

export async function disputeArAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await disputeCustomerInvoice(ctx, String(formData.get('id')), String(formData.get('reason') ?? ''));
  revalidatePath('/ar');
}

export async function promiseArAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await promiseToPay(ctx, String(formData.get('id')), new Date(String(formData.get('date'))));
  revalidatePath('/ar');
}

export async function cancelArAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await cancelCustomerInvoice(ctx, String(formData.get('id')), String(formData.get('reason') ?? '—'));
  revalidatePath('/ar');
}
