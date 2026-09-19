import { NextResponse } from 'next/server';
import { HttpTelegramBotApi, type TgUpdate } from '@finance-os/adapters';
import { handleTelegramUpdate } from '@finance-os/db';

/**
 * P-24 (docs/21 §6): webhook Telegram-бота сотрудников. Проверка секрета заголовком X-Telegram-Bot-Api-Secret-Token
 * (setWebhook secret_token). Всегда 200 на валидный апдейт — иначе Telegram повторяет доставку. Токен только из env.
 */
export async function POST(request: Request): Promise<Response> {
  const token = process.env.TELEGRAM_BOT_TOKEN; const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) return NextResponse.json({ error: 'BOT_NOT_CONFIGURED' }, { status: 503 });
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let update: TgUpdate;
  try { update = (await request.json()) as TgUpdate; } catch { return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 }); }
  try {
    await handleTelegramUpdate(update, new HttpTelegramBotApi(token));
  } catch (e) {
    console.error('[telegram] update failed:', e instanceof Error ? e.message : String(e)); // без токена и PII
  }
  return NextResponse.json({ ok: true });
}
