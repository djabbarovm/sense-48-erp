'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { IllegalTransitionError, PermissionDeniedError, ValidationError } from '@finance-os/core';
import { activateLease, createLease, terminateLease, updateLease } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

const str = (fd: FormData, k: string): string | undefined => {
  const v = fd.get(k);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};
const usdMinor = (v: string | undefined): bigint | null => {
  if (v === undefined) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new ValidationError('AMOUNT_INVALID');
  const [whole, frac = ''] = v.split('.');
  return BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'));
};

async function run(unitId: string, fn: () => Promise<void>): Promise<never> {
  let error: string | null = null;
  try {
    await fn();
  } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError || e instanceof IllegalTransitionError) error = e.code;
    else throw e;
  }
  revalidatePath(`/property/units/${unitId}`);
  revalidatePath('/property');
  revalidatePath('/leases');
  redirect(`/property/units/${unitId}${error ? `?error=${encodeURIComponent(error)}` : ''}`);
}

/** Новый договор c карточки юнита: DRAFT (+ активация сразу, если отмечено). */
export async function createLeaseAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const unitId = String(formData.get('unitId'));
  await run(unitId, async () => {
    const lease = await createLease(ctx, {
      unitId,
      type: (str(formData, 'type') ?? 'LTR') as 'LTR' | 'STR' | 'OWNER_USE',
      occupantName: str(formData, 'occupantName') ?? '',
      occupantContact: str(formData, 'occupantContact') ?? null,
      startAt: new Date(str(formData, 'startAt') ?? ''),
      endAt: str(formData, 'endAt') ? new Date(str(formData, 'endAt')!) : null,
      rentMinor: usdMinor(str(formData, 'rent')) ?? 0n,
      depositMinor: usdMinor(str(formData, 'deposit')),
      depositReceived: formData.get('depositReceived') === 'on',
    });
    if (formData.get('activate') === 'on') await activateLease(ctx, lease.id);
  });
}

export async function activateLeaseAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(String(formData.get('unitId')), () => activateLease(ctx, String(formData.get('leaseId'))).then(() => undefined));
}

export async function terminateLeaseAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(String(formData.get('unitId')), () => terminateLease(ctx, String(formData.get('leaseId')), str(formData, 'reason') ?? '').then(() => undefined));
}

export async function markDepositReceivedAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(String(formData.get('unitId')), () => updateLease(ctx, String(formData.get('leaseId')), { depositReceived: true }).then(() => undefined));
}
