import { NextResponse } from 'next/server';
import { checkRateLimit } from '@finance-os/core';
import { buildTelephonyAdapter, parseWebhookRawBody } from '@finance-os/adapters';
import { getTelephonySettings, ingestCallEvent, noteTelephonyWebhook, verifyApiKey } from '@finance-os/db';

/**
 * P-26/P-29 (docs/21 §7, docs/07 §8): webhook телефонии. Auth — X-Api-Key (scope TELEPHONY) определяет tenant;
 * АТС, которая не умеет заголовки, передаёт ключ в `?key=`. Тело — JSON или form-urlencoded.
 * Провайдер (generic | onlinepbx) и карта полей — из настроек тенанта; непонятое тело → ключи в диагностику.
 */
export async function POST(request: Request): Promise<Response> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!checkRateLimit(`telephony:${ip}`, 120, 60).allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  const url = new URL(request.url);
  const key = await verifyApiKey(request.headers.get('x-api-key') ?? url.searchParams.get('key'), 'TELEPHONY');
  if (!key) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = parseWebhookRawBody(request.headers.get('content-type'), await request.text()); } catch { return NextResponse.json({ error: 'BAD_BODY' }, { status: 400 }); }
  const settings = await getTelephonySettings(key.tenantId);
  const ev = buildTelephonyAdapter(settings).parseWebhook(body);
  const keys = Object.keys(body);
  await noteTelephonyWebhook(key.tenantId, !!ev, keys);
  if (!ev) return NextResponse.json({ ok: true, status: 'IGNORED', keys });
  const r = await ingestCallEvent(key.tenantId, ev);
  return NextResponse.json({ ok: true, status: r.status, ...(r.dealId ? { dealId: r.dealId } : {}) });
}
