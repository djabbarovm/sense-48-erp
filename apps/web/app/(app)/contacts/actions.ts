'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { NotFoundError, PermissionDeniedError, ValidationError, type ContactKind } from '@finance-os/core';
import type { DealSource } from '@finance-os/db';
import { createContact, mergeContacts, updateContact } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

const str = (fd: FormData, k: string): string | undefined => { const v = fd.get(k); return typeof v === 'string' && v.trim() ? v.trim() : undefined; };

async function run(back: string, fn: () => Promise<string | void>): Promise<never> {
  let error: string | null = null; let to = back;
  try { const r = await fn(); if (typeof r === 'string') to = r; } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError) error = e.code;
    else if (e instanceof NotFoundError) error = 'NOT_FOUND';
    else throw e;
  }
  revalidatePath('/contacts'); revalidatePath(back);
  redirect(`${to}${error ? `${to.includes('?') ? '&' : '?'}error=${encodeURIComponent(error)}` : ''}`);
}

export async function createContactAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await run('/contacts', async () => {
    const c = await createContact(ctx, { displayName: str(formData, 'displayName') ?? '', kind: (str(formData, 'kind') ?? 'PERSON') as ContactKind, phone: str(formData, 'phone') ?? null, email: str(formData, 'email') ?? null, company: str(formData, 'company') ?? null, position: str(formData, 'position') ?? null, source: (str(formData, 'source') ?? null) as DealSource | null, tags: (str(formData, 'tags') ?? '').split(/[;,]/).map((t) => t.trim()).filter(Boolean), notes: str(formData, 'notes') ?? null });
    return `/contacts/${c.id}`;
  });
}

export async function updateContactAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const id = str(formData, 'id') ?? '';
  await run(`/contacts/${id}`, () => updateContact(ctx, id, { displayName: str(formData, 'displayName') ?? '', kind: (str(formData, 'kind') ?? 'PERSON') as ContactKind, phone: str(formData, 'phone') ?? null, phoneAlt: str(formData, 'phoneAlt') ?? null, email: str(formData, 'email') ?? null, company: str(formData, 'company') ?? null, position: str(formData, 'position') ?? null, source: (str(formData, 'source') ?? null) as DealSource | null, tags: (str(formData, 'tags') ?? '').split(/[;,]/).map((t) => t.trim()).filter(Boolean), notes: str(formData, 'notes') ?? null }).then(() => undefined));
}

export async function mergeContactsAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  const keep = str(formData, 'keepId') ?? '';
  await run(`/contacts/${keep}`, () => mergeContacts(ctx, keep, str(formData, 'mergeId') ?? '').then(() => undefined));
}
