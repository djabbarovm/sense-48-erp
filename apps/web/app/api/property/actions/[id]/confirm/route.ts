import { NextResponse } from 'next/server';
import { NotFoundError, PermissionDeniedError, ValidationError } from '@finance-os/core';
import { confirmActionDraft, rejectActionDraft } from '@finance-os/db';
import { botContext, draftJson } from '../../_auth';

/** POST {telegramChatId, decision: 'confirm'|'reject', reason?} → commit через сервисы c правами сотрудника. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  let body: { telegramChatId?: string; decision?: string; reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }
  const auth = await botContext(request, body);
  if ('error' in auth) return auth.error;
  try {
    const draft = body.decision === 'reject' ? await rejectActionDraft(auth.ctx, id, body.reason) : await confirmActionDraft(auth.ctx, id);
    return NextResponse.json({ draft: draftJson(draft) });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    if (e instanceof ValidationError) return NextResponse.json({ error: e.code }, { status: 400 });
    if (e instanceof PermissionDeniedError) return NextResponse.json({ error: e.code }, { status: 403 });
    throw e;
  }
}
