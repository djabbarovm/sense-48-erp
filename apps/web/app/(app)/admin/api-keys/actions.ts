'use server';

import { revalidatePath } from 'next/cache';
import { PermissionDeniedError, ValidationError } from '@finance-os/core';
import { createApiKey, revokeApiKey, type ApiScope } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';

export interface ApiKeyState {
  plaintext?: string;
  prefix?: string;
  error?: string;
}

/** Ключ возвращается один раз в состоянии формы и нигде не сохраняется в открытом виде. */
export async function createApiKeyAction(_prev: ApiKeyState, formData: FormData): Promise<ApiKeyState> {
  const ctx = await requireTenantContext();
  try {
    const scopes = formData.getAll('scopes').map(String) as ApiScope[];
    const key = await createApiKey(ctx, { name: String(formData.get('name') ?? ''), scopes });
    revalidatePath('/admin/api-keys');
    return { plaintext: key.plaintext, prefix: key.prefix };
  } catch (e) {
    if (e instanceof ValidationError || e instanceof PermissionDeniedError) return { error: e.code };
    throw e;
  }
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const ctx = await requireTenantContext();
  await revokeApiKey(ctx, String(formData.get('id')));
  revalidatePath('/admin/api-keys');
}
