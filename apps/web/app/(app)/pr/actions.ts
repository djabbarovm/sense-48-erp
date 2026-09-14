'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { UrgencyReason } from '@finance-os/db';
import { createPr, decidePrApproval, submitPr, transitionPr } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function createPrAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const soum = String(formData.get('amount') ?? '0').replace(/\s/g, '');
  const vendorId = String(formData.get('vendorId') ?? '');
  const neededBy = String(formData.get('neededBy') ?? '');
  const urgencyReason = String(formData.get('urgencyReason') ?? '');
  const varianceReason = String(formData.get('varianceReason') ?? '');
  const pr = await createPr(ctx, {
    what: String(formData.get('what') ?? ''),
    purpose: String(formData.get('purpose') ?? ''),
    totalMinor: BigInt(soum || '0') * 100n,
    costCenterId: String(formData.get('costCenterId')),
    categoryId: String(formData.get('categoryId')),
    ...(vendorId ? { vendorId } : {}),
    ...(neededBy ? { neededBy: new Date(neededBy) } : {}),
    isUrgent: formData.get('isUrgent') === 'on',
    ...(urgencyReason ? { urgencyReason: urgencyReason as UrgencyReason } : {}),
    ...(varianceReason ? { varianceReason } : {}),
  });
  redirect(`/pr/${pr.id}`);
}

export async function submitPrAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  await submitPr(ctx, id);
  revalidatePath(`/pr/${id}`);
}

export async function decideApprovalAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  await decidePrApproval(
    ctx,
    id,
    String(formData.get('role')),
    String(formData.get('decision')) as 'APPROVED' | 'REJECTED',
    String(formData.get('comment') ?? '') || undefined,
  );
  revalidatePath(`/pr/${id}`);
  revalidatePath('/approvals');
}

export async function cancelPrAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  await transitionPr(ctx, id, 'cancel', { comment: String(formData.get('comment') ?? '') });
  revalidatePath(`/pr/${id}`);
}

export async function createPoAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const { createPo } = await import('@finance-os/db');
  const id = String(formData.get('id'));
  await createPo(ctx, id);
  revalidatePath(`/pr/${id}`);
}

export async function createReceiptAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const { createReceipt } = await import('@finance-os/db');
  const id = String(formData.get('id'));
  await createReceipt(ctx, {
    prId: id,
    status: formData.get('partial') === '1' ? 'PARTIAL' : 'FULL',
  });
  revalidatePath(`/pr/${id}`);
}
