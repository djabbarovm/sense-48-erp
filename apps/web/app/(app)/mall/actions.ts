'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { AssetKind } from '@finance-os/db';
import { IllegalTransitionError, NotFoundError, PermissionDeniedError, ValidationError, type MandateTrigger } from '@finance-os/core';
import { createAsset, createAssetContract, createMandate, endAssetContract, transitionMandate, updateMandate } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

const str = (fd: FormData, k: string): string | undefined => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : undefined; };
const usdMinor = (v: string | undefined): bigint | null => {
  if (v === undefined) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new ValidationError('AMOUNT_INVALID');
  const [whole, frac = ''] = v.split('.');
  return BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'));
};
const pctBp = (v: string | undefined): number | null => (v === undefined ? null : Math.round(Number(v) * 100));

async function run(back: string, fn: () => Promise<void>): Promise<never> {
  let error: string | null = null;
  try { await fn(); } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError || e instanceof IllegalTransitionError) error = e.code;
    else if (e instanceof NotFoundError) error = 'NOT_FOUND';
    else throw e;
  }
  revalidatePath('/mall'); revalidatePath('/property'); revalidatePath('/owner'); revalidatePath(back);
  redirect(`${back}${error ? `${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error)}` : ''}`);
}

export async function createMandateAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const unitId = str(formData, 'unitId') ?? '';
  const back = str(formData, 'back') ?? '/mall?view=mandates';
  await run(back, () => createMandate(ctx, { unitId, feeBp: pctBp(str(formData, 'feePct')), successFeeMonths: str(formData, 'successFee') ? Number(str(formData, 'successFee')) : null, startAt: str(formData, 'startAt') ? new Date(str(formData, 'startAt')!) : null, endAt: str(formData, 'endAt') ? new Date(str(formData, 'endAt')!) : null, notes: str(formData, 'notes') ?? null }).then(() => undefined));
}

export async function transitionMandateAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const back = str(formData, 'back') ?? '/mall?view=mandates';
  await run(back, () => transitionMandate(ctx, String(formData.get('id')), String(formData.get('trigger')) as MandateTrigger, { ...(str(formData, 'reason') ? { reason: str(formData, 'reason')! } : {}) }).then(() => undefined));
}

export async function updateMandateAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const back = str(formData, 'back') ?? '/mall?view=mandates';
  const publish = formData.get('feePublished');
  await run(back, () => updateMandate(ctx, String(formData.get('id')), { ...(formData.has('feePct') ? { feeBp: pctBp(str(formData, 'feePct')) } : {}), ...(formData.has('successFee') ? { successFeeMonths: str(formData, 'successFee') ? Number(str(formData, 'successFee')) : null } : {}), ...(publish !== null ? { feePublished: publish === '1' } : {}) }).then(() => undefined));
}

export async function createAssetAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run('/mall?view=assets', () => createAsset(ctx, { buildingId: str(formData, 'buildingId') ?? '', kind: (str(formData, 'kind') ?? 'MEDIA') as AssetKind, code: (str(formData, 'code') ?? '').toUpperCase(), name: str(formData, 'name') ?? '', location: str(formData, 'location') ?? null, tariffMinor: usdMinor(str(formData, 'tariff')) }).then(() => undefined));
}

export async function createAssetContractAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run('/mall?view=assets', () => createAssetContract(ctx, { assetId: String(formData.get('assetId')), counterpartyName: str(formData, 'counterpartyName') ?? '', monthlyMinor: usdMinor(str(formData, 'monthly')) ?? 0n, startAt: new Date(str(formData, 'startAt') ?? ''), endAt: str(formData, 'endAt') ? new Date(str(formData, 'endAt')!) : null }).then(() => undefined));
}

export async function endAssetContractAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run('/mall?view=assets', () => endAssetContract(ctx, String(formData.get('id'))).then(() => undefined));
}
