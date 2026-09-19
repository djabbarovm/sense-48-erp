import { NextResponse } from 'next/server';
import { ValidationError, checkRateLimit } from '@finance-os/core';
import type { DealSource } from '@finance-os/db';
import { intakeLead, verifyApiKey } from '@finance-os/db';

/**
 * P-17 (blueprint §3/§8/§14): лид c сайта/бота → Deal c source и UTM. Auth — X-Api-Key (scope LEADS).
 * Ответ не раскрывает ничего, кроме номера сделки (для «спасибо, ваш номер обращения»).
 */
const SOURCES: DealSource[] = ['WEBSITE', 'TELEGRAM', 'INSTAGRAM', 'REFERRAL', 'BROKER', 'WALK_IN', 'OTHER'];

export async function POST(request: Request): Promise<Response> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!checkRateLimit(`leads:${ip}`, 30, 60).allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  const key = await verifyApiKey(request.headers.get('x-api-key'), 'LEADS');
  if (!key) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'BAD_JSON' }, { status: 400 });
  }
  const str = (k: string) => (typeof body[k] === 'string' && (body[k] as string).trim() ? (body[k] as string).trim().slice(0, 500) : null);
  const utmRaw = body.utm && typeof body.utm === 'object' ? (body.utm as Record<string, unknown>) : null;
  const utm = utmRaw ? Object.fromEntries(Object.entries(utmRaw).filter(([k, v]) => /^utm_[a-z]+$/.test(k) && typeof v === 'string').map(([k, v]) => [k, String(v).slice(0, 120)])) : null;
  const source = SOURCES.includes(str('source') as DealSource) ? (str('source') as DealSource) : 'WEBSITE';
  try {
    const r = await intakeLead(key.tenantId, {
      contactName: str('name') ?? str('contactName') ?? '',
      contactPhone: str('phone'),
      contactEmail: str('email'),
      company: str('company'),
      message: str('message'),
      unitNo: str('unitNo'),
      buildingCode: str('buildingCode'),
      purpose: str('purpose'),
      budgetMinor: typeof body.budget === 'number' && Number.isFinite(body.budget) && body.budget >= 0 ? BigInt(Math.round(body.budget * 100)) : null,
      source,
      utm: utm && Object.keys(utm).length ? utm : null,
      page: str('page'),
    });
    return NextResponse.json({ ok: true, number: r.number, created: r.created }, { status: r.created ? 201 : 200 });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.code }, { status: e.code === 'RATE_LIMITED' ? 429 : 400 });
    throw e;
  }
}
