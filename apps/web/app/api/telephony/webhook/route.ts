import { NextResponse } from 'next/server';
import { checkRateLimit } from '@finance-os/core';
import { GenericTelephonyAdapter } from '@finance-os/adapters';
import { ingestCallEvent, verifyApiKey } from '@finance-os/db';

/**
 * P-26 (docs/21 §7, docs/07 §8): webhook телефонии. Auth — X-Api-Key (scope TELEPHONY) определяет tenant.
 * Тело — нормализованный JSON (GenericTelephonyAdapter); провайдерский формат подключается своим адаптером.
 */
const adapter = new GenericTelephonyAdapter();

export async function POST(request: Request): Promise<Response> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!checkRateLimit(`telephony:${ip}`, 120, 60).allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  const key = await verifyApiKey(request.headers.get('x-api-key'), 'TELEPHONY');
  if (!key) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 }); }
  const ev = adapter.parseWebhook(body);
  if (!ev) return NextResponse.json({ ok: true, status: 'IGNORED' });
  const r = await ingestCallEvent(key.tenantId, ev);
  return NextResponse.json({ ok: true, status: r.status, ...(r.dealId ? { dealId: r.dealId } : {}) });
}
