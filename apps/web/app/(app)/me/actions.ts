'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { IllegalTransitionError, NotFoundError, PermissionDeniedError, ValidationError } from '@finance-os/core';
import type { DealLostReason, ViewingResult } from '@finance-os/db';
import { issueTelegramLinkCode, ownerQuickCall, quickCall, quickLead, scheduleViewing, taskDone, unlinkTelegramChat, viewingResult } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

const str = (fd: FormData, k: string): string | undefined => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : undefined; };
// datetime-local / date из формы — локальное время Ташкента (+05:00), не UTC
const dt = (v: string | undefined): Date | null => (v ? new Date(v.length === 10 ? `${v}T09:00:00+05:00` : v.length === 16 ? `${v}:00+05:00` : v) : null);
const usd = (v: string | undefined): bigint | null => (v && /^\d+(\.\d{1,2})?$/.test(v) ? BigInt(Math.round(Number(v) * 100)) : null);

async function run(back: string, fn: () => Promise<unknown>): Promise<never> {
  let error: string | null = null;
  try { await fn(); } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError || e instanceof IllegalTransitionError) error = e.code;
    else if (e instanceof NotFoundError) error = 'NOT_FOUND';
    else throw e;
  }
  revalidatePath('/me'); revalidatePath('/deals'); revalidatePath('/property/today'); revalidatePath('/property/owners');
  redirect(`${back}${error ? `${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(error)}` : ''}`);
}

export async function quickCallAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(str(formData, 'back') ?? '/me', () => quickCall(ctx, str(formData, 'dealId') ?? '', { note: str(formData, 'note') ?? 'Звонок', nextAction: str(formData, 'nextAction') ?? null, nextActionAt: dt(str(formData, 'nextActionAt')) }));
}

export async function scheduleViewingAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const at = dt(str(formData, 'at'));
  await run(str(formData, 'back') ?? '/me', () => { if (!at) throw new ValidationError('DATE_REQUIRED'); return scheduleViewing(ctx, str(formData, 'dealId') ?? '', { at, unitId: str(formData, 'unitId') ?? null, unitNo: str(formData, 'unitNo') ?? null, note: str(formData, 'note') ?? null }); });
}

export async function viewingResultAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(str(formData, 'back') ?? '/me', () => viewingResult(ctx, str(formData, 'dealId') ?? '', { result: (str(formData, 'result') ?? 'THINKING') as ViewingResult, note: str(formData, 'note') ?? null, expectedRateMinor: usd(str(formData, 'expectedRate')), followUpAt: dt(str(formData, 'followUpAt')), lostReason: (str(formData, 'lostReason') ?? null) as DealLostReason | null }));
}

export async function quickLeadAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(str(formData, 'back') ?? '/me', () => quickLead(ctx, { contactName: str(formData, 'contactName') ?? '', contactPhone: str(formData, 'contactPhone') ?? null, note: str(formData, 'note') ?? null, unitNo: str(formData, 'unitNo') ?? null, source: (str(formData, 'source') ?? 'WALK_IN') as 'WALK_IN' }));
}

export async function ownerQuickCallAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(str(formData, 'back') ?? '/me', () => ownerQuickCall(ctx, str(formData, 'ownerId') ?? '', { note: str(formData, 'note') ?? 'Звонок', followUpAt: dt(str(formData, 'followUpAt')) }));
}

export async function taskDoneAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run(str(formData, 'back') ?? '/me', () => taskDone(ctx, str(formData, 'taskId') ?? ''));
}

/** P-24: код привязки Telegram — показывается один раз в «Мой день», действует до использования. */
export async function issueTelegramLinkAction(): Promise<void> {
  const ctx = await requireTenantContext();
  await issueTelegramLinkCode(ctx.userId);
  revalidatePath('/me'); redirect('/me?tg=1');
}
export async function unlinkTelegramAction(): Promise<void> {
  const ctx = await requireTenantContext();
  await unlinkTelegramChat(ctx.userId);
  revalidatePath('/me'); redirect('/me');
}
