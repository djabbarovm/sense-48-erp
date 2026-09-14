'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { BatchType } from '@finance-os/db';
import { approveBatch, createBatch, freezeBatch, markBatchSent, removeFromBatch, reviewBatch, unfreezeBatch } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function createBatchAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const created = await createBatch(ctx, {
    bankAccountId: String(formData.get('bankAccountId')),
    type: (String(formData.get('type') ?? 'STANDARD') as BatchType) || 'STANDARD',
  });
  redirect(`/batches/${created.id}`);
}

export async function freezeBatchAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  await freezeBatch(ctx, id);
  revalidatePath(`/batches/${id}`);
}

export async function unfreezeBatchAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  await unfreezeBatch(ctx, id);
  revalidatePath(`/batches/${id}`);
}

export async function reviewBatchAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  await reviewBatch(ctx, id);
  revalidatePath(`/batches/${id}`);
}

/** Approve batch: чекбокс reject-<paymentId> + comment-<paymentId> на каждом item. */
export async function approveBatchAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  const rejections: { paymentId: string; comment: string }[] = [];
  for (const [key] of formData.entries()) {
    if (key.startsWith('reject-')) {
      const paymentId = key.slice('reject-'.length);
      rejections.push({ paymentId, comment: String(formData.get(`comment-${paymentId}`) ?? '') });
    }
  }
  await approveBatch(ctx, id, rejections);
  revalidatePath(`/batches/${id}`);
  revalidatePath('/approvals');
}

export async function removeFromBatchAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const batchId = String(formData.get('batchId'));
  await removeFromBatch(ctx, String(formData.get('paymentId')));
  revalidatePath(`/batches/${batchId}`);
}

export async function markSentAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  await markBatchSent(ctx, id);
  revalidatePath(`/batches/${id}`);
}
