import { NextResponse } from 'next/server';
import { PermissionDeniedError, ValidationError } from '@finance-os/core';
import { createActionDraft } from '@finance-os/db';
import { botContext, draftJson } from '../_auth';

/** POST {telegramChatId, text} → черновик c preview (ничего не меняет). Подтверждение — отдельным запросом. */
export async function POST(request: Request): Promise<Response> {
  let body: { telegramChatId?: string; text?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }
  const auth = await botContext(request, body);
  if ('error' in auth) return auth.error;
  try {
    const draft = await createActionDraft(auth.ctx, { text: String(body.text ?? ''), source: 'TELEGRAM' });
    return NextResponse.json({ draft: draftJson(draft), confirmUrl: `/api/property/actions/${draft.id}/confirm` }, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.code }, { status: 400 });
    if (e instanceof PermissionDeniedError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
}
