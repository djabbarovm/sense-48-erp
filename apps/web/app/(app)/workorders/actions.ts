'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { WorkOrderCategory } from '@finance-os/db';
import { IllegalTransitionError, PermissionDeniedError, ValidationError, type WorkOrderPriority, type WorkOrderTrigger } from '@finance-os/core';
import { createStorageFromEnv } from '@finance-os/adapters';
import { createWorkOrder, transitionWorkOrder, uploadDocument } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

const str = (fd: FormData, k: string): string | undefined => {
  const v = fd.get(k);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

async function run(back: string, fn: () => Promise<string | void>): Promise<never> {
  let error: string | null = null;
  let target = back;
  try {
    const r = await fn();
    if (r) target = r;
  } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError || e instanceof IllegalTransitionError) error = e.code;
    else throw e;
  }
  revalidatePath('/workorders');
  revalidatePath('/property');
  revalidatePath(target);
  redirect(`${target}${error ? `?error=${encodeURIComponent(error)}` : ''}`);
}

export async function createWorkOrderAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const unitId = str(formData, 'unitId') ?? null;
  const back = unitId ? `/property/units/${unitId}` : '/workorders';
  await run(back, async () => {
    const wo = await createWorkOrder(ctx, {
      unitId,
      buildingId: str(formData, 'buildingId') ?? null,
      category: (str(formData, 'category') ?? 'OTHER') as WorkOrderCategory,
      priority: (str(formData, 'priority') ?? 'NORMAL') as WorkOrderPriority,
      title: str(formData, 'title') ?? '',
      description: str(formData, 'description') ?? null,
      location: str(formData, 'location') ?? null,
      assigneeId: str(formData, 'assigneeId') ?? null,
    });
    return `/workorders/${wo.id}`;
  });
}

export async function transitionWorkOrderAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  await run(`/workorders/${id}`, () =>
    transitionWorkOrder(ctx, id, String(formData.get('trigger')) as WorkOrderTrigger, {
      ...(str(formData, 'assigneeId') ? { assigneeId: str(formData, 'assigneeId')! } : {}),
      ...(formData.has('contractorName') ? { contractorName: str(formData, 'contractorName') ?? null } : {}),
      ...(str(formData, 'reason') ? { reason: str(formData, 'reason')! } : {}),
    }).then(() => undefined),
  );
}

export async function uploadProofAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  const file = formData.get('file');
  await run(`/workorders/${id}`, async () => {
    if (!(file instanceof File) || file.size === 0) throw new ValidationError('FILE_EMPTY');
    if (!/^image\//.test(file.type)) throw new ValidationError('IMAGE_REQUIRED');
    await uploadDocument(ctx, createStorageFromEnv(), { objectType: 'work_order', objectId: id, docType: 'OTHER', fileName: file.name, mime: file.type, body: Buffer.from(await file.arrayBuffer()) });
  });
}
