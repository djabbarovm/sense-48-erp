'use server';

import { redirect } from 'next/navigation';
import { requestViewingFromProposal } from '@finance-os/db';

/** Публичное действие клиента по КП: запрос показа (без auth, один раз на предложение). */
export async function requestViewingAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  const note = String(formData.get('note') ?? '').trim().slice(0, 300);
  const ok = await requestViewingFromProposal(token, { note: note || null });
  redirect(`/p/${encodeURIComponent(token)}?${ok ? 'sent=1' : 'sent=0'}`);
}
