import { NextResponse } from 'next/server';
import { checkRateLimit } from '@finance-os/core';
import { listPublicInventory, verifyApiKey } from '@finance-os/db';

/**
 * Wave 2 (docs/20 §11.3): публичный inventory для сайта/бота — только опубликованные юниты, без PII.
 * Auth: заголовок X-Api-Key (scope PUBLIC_INVENTORY); tenant определяется ключом, не параметром.
 */
export async function GET(request: Request): Promise<Response> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const limit = checkRateLimit(`public-inventory:${ip}`, 120, 60);
  if (!limit.allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec ?? 60) } });
  const key = await verifyApiKey(request.headers.get('x-api-key'), 'PUBLIC_INVENTORY');
  if (!key) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const units = await listPublicInventory(key.tenantId);
  return NextResponse.json({ units, generatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'private, max-age=60' } });
}
