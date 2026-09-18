import { NextResponse } from 'next/server';
import { checkRateLimit } from '@finance-os/core';
import { buildTenantContext, resolveBotUser, verifyApiKey } from '@finance-os/db';

/**
 * Auth API WorkBot (docs/20 §11.4): X-Api-Key (scope WORKBOT) определяет tenant; пользователь — по telegramChatId
 * (User.telegramChatId) c ролью в этом tenant. Бот действует ОТ ИМЕНИ сотрудника: права и audit — его.
 */
export async function botContext(request: Request, body: { telegramChatId?: string }) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = checkRateLimit(`workbot:${ip}`, 60, 60);
  if (!limit.allowed) return { error: NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 }) };
  const key = await verifyApiKey(request.headers.get('x-api-key'), 'WORKBOT');
  if (!key) return { error: NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }) };
  const chatId = String(body.telegramChatId ?? request.headers.get('x-telegram-chat-id') ?? '').trim();
  if (!chatId) return { error: NextResponse.json({ error: 'TELEGRAM_CHAT_ID_REQUIRED' }, { status: 400 }) };
  const user = await resolveBotUser(key.tenantId, chatId);
  if (!user) return { error: NextResponse.json({ error: 'USER_NOT_LINKED' }, { status: 403 }) };
  return { ctx: await buildTenantContext(user.userId, user.tenantSlug) };
}

export const draftJson = (d: { id: string; status: string; kind: string | null; preview: string; confidence: number; resultRef: string | null; error: string | null }) => ({
  id: d.id, status: d.status, kind: d.kind, preview: d.preview, confidence: d.confidence, resultRef: d.resultRef, error: d.error,
});
