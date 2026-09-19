'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NotFoundError, PermissionDeniedError, ValidationError, type OwnerLostReason, type OwnerStage } from '@finance-os/core';
import type { UnitActivityKind } from '@finance-os/db';
import { addOwnerActivity, linkOwnerUser, markCalcShown, moveOwnerStage, setOwnerNextAction } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export async function linkOwnerUserAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  let error: string | null = null;
  try {
    const email = String(formData.get('email') ?? '').trim();
    await linkOwnerUser(ctx, String(formData.get('ownerId')), formData.get('unlink') === '1' ? null : email);
  } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError) error = e.code;
    else throw e;
  }
  revalidatePath('/property/owners');
  redirect(`/property/owners${error ? `?error=${encodeURIComponent(error)}` : ''}`);
}

const str = (fd: FormData, k: string): string | undefined => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : undefined; };
// datetime-local / date из формы — локальное время Ташкента (+05:00), не UTC
const dt = (v: string | undefined): Date | null => (v ? new Date(v.length === 10 ? `${v}T09:00:00+05:00` : v.length === 16 ? `${v}:00+05:00` : v) : null);

async function run(back: string, fn: () => Promise<unknown>): Promise<never> {
  let error: string | null = null;
  try { await fn(); } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError) error = e.code;
    else if (e instanceof NotFoundError) error = 'NOT_FOUND';
    else throw e;
  }
  revalidatePath('/property/owners'); revalidatePath('/property/today'); revalidatePath(back);
  redirect(`${back}${error ? `${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error)}` : ''}`);
}

/** P-22b: переход по воронке собственников (BR-P57). */
export async function moveOwnerStageAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const ownerId = str(formData, 'ownerId') ?? '';
  const back = str(formData, 'back') ?? `/property/owners/${ownerId}`;
  await run(back, () => moveOwnerStage(ctx, ownerId, (str(formData, 'stage') ?? 'LEAD') as OwnerStage, { reason: (str(formData, 'reason') ?? null) as OwnerLostReason | null, note: str(formData, 'note') ?? null, signedAt: dt(str(formData, 'signedAt')) }));
}

export async function setOwnerNextActionAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const ownerId = str(formData, 'ownerId') ?? '';
  await run(str(formData, 'back') ?? `/property/owners/${ownerId}`, () => setOwnerNextAction(ctx, ownerId, { nextAction: str(formData, 'nextAction') ?? null, nextActionAt: dt(str(formData, 'nextActionAt')), ...(str(formData, 'managerId') ? { managerId: str(formData, 'managerId')! } : {}) }));
}

export async function addOwnerActivityAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const ownerId = str(formData, 'ownerId') ?? '';
  await run(`/property/owners/${ownerId}`, () => addOwnerActivity(ctx, ownerId, { kind: (str(formData, 'kind') ?? 'NOTE') as UnitActivityKind, note: str(formData, 'note') ?? '', followUpAt: dt(str(formData, 'followUpAt')), unitId: str(formData, 'unitId') ?? null }));
}

/** Расчёт показан собственнику — фиксируем и двигаем в CALC_SHOWN (BR-P58). */
export async function markCalcShownAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const ownerId = str(formData, 'ownerId') ?? '';
  await run(`/property/owners/${ownerId}`, () => markCalcShown(ctx, ownerId, str(formData, 'summary') ?? ''));
}
