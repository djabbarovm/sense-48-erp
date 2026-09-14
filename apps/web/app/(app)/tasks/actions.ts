'use server';

import { revalidatePath } from 'next/cache';
import type { TaskStatus } from '@finance-os/db';
import { setTaskStatus } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function setTaskStatusAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await setTaskStatus(
    ctx,
    String(formData.get('taskId')),
    String(formData.get('status')) as TaskStatus,
    String(formData.get('reason') ?? '') || undefined,
  );
  revalidatePath('/tasks');
}
