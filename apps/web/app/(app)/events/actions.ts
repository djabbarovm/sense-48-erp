'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { EventTrigger } from '@finance-os/core';
import { createEvent, recordDeposit, transitionEvent, upsertEventBudgetLine } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

const soumToMinor = (value: FormDataEntryValue | null) => BigInt(String(value ?? '0').replace(/\s/g, '') || '0') * 100n;

export async function createEventAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const customerId = String(formData.get('customerId') ?? '');
  const depositPct = Number(formData.get('depositPct') ?? 0);
  const created = await createEvent(ctx, {
    name: String(formData.get('name') ?? ''),
    eventDate: new Date(String(formData.get('eventDate'))),
    ...(customerId ? { customerId } : {}),
    format: (String(formData.get('format') ?? 'BANQUET') || 'BANQUET') as 'BANQUET',
    guestsPlanned: Number(formData.get('guests') ?? 0) || null,
    revenueBudgetMinor: soumToMinor(formData.get('revenue')),
    revenueLines: { venue_fee: String(formData.get('revenue') ?? '0') },
    ...(depositPct > 0
      ? { depositSchedule: [{ pct: depositPct, due_date: String(formData.get('eventDate')) }] }
      : {}),
  });
  redirect(`/events/${created.id}`);
}

export async function eventTransitionAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = String(formData.get('id'));
  const trigger = String(formData.get('trigger')) as EventTrigger;
  const guests = Number(formData.get('guestsActual') ?? 0);
  const reason = String(formData.get('reason') ?? '');
  await transitionEvent(ctx, id, trigger, {
    ...(guests > 0 ? { guestsActual: guests } : {}),
    ...(reason ? { closeOverrideReason: reason } : {}),
    ownerOverride: formData.get('ownerOverride') === 'on',
  });
  revalidatePath(`/events/${id}`);
  revalidatePath('/events');
}

export async function upsertBudgetLineAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const eventId = String(formData.get('eventId'));
  await upsertEventBudgetLine(ctx, eventId, {
    categoryId: String(formData.get('categoryId')),
    plannedMinor: soumToMinor(formData.get('planned')),
  });
  revalidatePath(`/events/${eventId}`);
}

export async function recordDepositAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const eventId = String(formData.get('eventId'));
  await recordDeposit(ctx, eventId, Number(formData.get('index') ?? 0), soumToMinor(formData.get('amount')));
  revalidatePath(`/events/${eventId}`);
}
