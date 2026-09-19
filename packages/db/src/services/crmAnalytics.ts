/**
 * P-26: аналитика CRM (docs/21 §7) — скорость, объём, конверсия, качество по сотрудникам и источникам; звонки.
 * Всё считается из активностей (UnitActivity) и событий, без отдельного трекинга.
 */
import type { TenantContext } from '@finance-os/core';
import { OWNER_ACTIVE_STAGES, ownerConversion, ownerSegment, requirePermission, type OwnerStage } from '@finance-os/core';
import { prisma } from '../client.js';

const ACTIVE = ['NEW', 'QUALIFIED', 'PROPERTY_SELECTED', 'VIEWING', 'OFFER', 'NEGOTIATION', 'LOI', 'CONTRACT', 'MOVE_IN'];
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); };
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export async function getCrmAnalytics(ctx: TenantContext, days = 30, now = new Date()) {
  requirePermission(ctx, 'deal.view');
  const from = new Date(now.getTime() - days * 86_400_000);
  const [deals, acts, users, slaWarn, slaEsc, owners] = await Promise.all([
    prisma.deal.findMany({ where: { tenantId: ctx.tenantId, createdAt: { gte: from } }, select: { id: true, source: true, managerId: true, stage: true, createdAt: true, nextAction: true, nextActionAt: true, updatedAt: true } }),
    prisma.unitActivity.findMany({ where: { tenantId: ctx.tenantId, happenedAt: { gte: from } }, select: { dealId: true, ownerId: true, kind: true, source: true, actorId: true, happenedAt: true, followUpAt: true, durationSec: true, callDirection: true, note: true } }),
    prisma.userTenantRole.findMany({ where: { tenantId: ctx.tenantId, role: { in: ['COMMERCIAL_MANAGER', 'BROKER', 'CALL_CENTER', 'OWNER'] } }, include: { user: { select: { id: true, fullName: true } } }, distinct: ['userId'] }),
    prisma.domainEvent.count({ where: { tenantId: ctx.tenantId, type: 'lead.sla.warn', createdAt: { gte: from } } }),
    prisma.domainEvent.count({ where: { tenantId: ctx.tenantId, type: 'lead.sla.escalate', createdAt: { gte: from } } }),
    prisma.propertyOwner.findMany({ where: { tenantId: ctx.tenantId }, select: { pipelineStage: true, stageChangedAt: true, nextActionAt: true, units: { select: { type: true, areaM2: true } } } }),
  ]);
  const names = new Map(users.map((u) => [u.user.id, u.user.fullName]));
  const human = acts.filter((a) => a.source !== 'API');
  // Скорость: первое касание сотрудника после создания лида
  const firstTouch = deals.map((d) => { const first = human.filter((a) => a.dealId === d.id && a.happenedAt > d.createdAt).sort((a, b) => a.happenedAt.getTime() - b.happenedAt.getTime())[0]; return { d, minutes: first ? Math.round((first.happenedAt.getTime() - d.createdAt.getTime()) / 60_000) : null }; });
  const touched = firstTouch.filter((x) => x.minutes != null) as { d: (typeof deals)[number]; minutes: number }[];
  const bySource = [...new Set(deals.map((d) => d.source))].map((source) => { const xs = touched.filter((x) => x.d.source === source).map((x) => x.minutes); const all = deals.filter((d) => d.source === source); return { source, leads: all.length, avgMinutes: avg(xs), medianMinutes: median(xs), within15Pct: all.length ? Math.round((xs.filter((m) => m <= 15).length / all.length) * 100) : null, untouched: all.filter((d) => d.stage === 'NEW' && !touched.some((x) => x.d.id === d.id)).length }; });
  // Объём и скорость по сотруднику
  const staff = [...names.keys()].map((uid) => {
    const mine = acts.filter((a) => a.actorId === uid && a.source !== 'API');
    const myDeals = deals.filter((d) => d.managerId === uid);
    const xs = touched.filter((x) => x.d.managerId === uid).map((x) => x.minutes);
    const calls = mine.filter((a) => a.kind === 'CALL');
    return { userId: uid, name: names.get(uid) ?? '—', leads: myDeals.length, calls: calls.length, phoneCalls: calls.filter((a) => a.source === 'PHONE').length, viewings: mine.filter((a) => a.kind === 'VIEWING').length, offers: mine.filter((a) => a.kind === 'OFFER').length, notes: mine.filter((a) => a.kind === 'NOTE' || a.kind === 'FOLLOW_UP').length, ownerTouches: mine.filter((a) => a.ownerId).length, avgFirstTouchMin: avg(xs), won: myDeals.filter((d) => d.stage === 'WON').length, lost: myDeals.filter((d) => d.stage === 'LOST').length, active: myDeals.filter((d) => ACTIVE.includes(d.stage)).length };
  }).filter((s) => s.leads || s.calls || s.viewings || s.notes || s.ownerTouches);
  // Конверсия шагов: сделки периода c показом → оффер и дальше
  const withViewing = new Set(acts.filter((a) => a.kind === 'VIEWING' && a.dealId).map((a) => a.dealId!));
  const stageIdx = (s: string) => ['NEW', 'QUALIFIED', 'PROPERTY_SELECTED', 'VIEWING', 'OFFER', 'NEGOTIATION', 'LOI', 'CONTRACT', 'MOVE_IN', 'WON'].indexOf(s);
  const reachedOffer = deals.filter((d) => stageIdx(d.stage) >= stageIdx('OFFER')).length;
  const reachedViewing = deals.filter((d) => withViewing.has(d.id) || stageIdx(d.stage) >= stageIdx('VIEWING')).length;
  const won = deals.filter((d) => d.stage === 'WON').length;
  // Качество
  const allActive = await prisma.deal.findMany({ where: { tenantId: ctx.tenantId, stage: { in: ACTIVE as never[] } }, select: { id: true, stage: true, nextAction: true, nextActionAt: true, updatedAt: true, managerId: true } });
  const lastAct = new Map<string, Date>(); for (const a of acts) if (a.dealId) lastAct.set(a.dealId, new Date(Math.max(lastAct.get(a.dealId)?.getTime() ?? 0, a.happenedAt.getTime())));
  const quality = {
    noNextAction: allActive.filter((d) => !d.nextAction).length,
    overdue: allActive.filter((d) => d.nextActionAt && d.nextActionAt < now).length,
    stale7d: allActive.filter((d) => (lastAct.get(d.id) ?? d.updatedAt).getTime() < now.getTime() - 7 * 86_400_000).length,
    viewingsNoResult: allActive.filter((d) => d.stage === 'VIEWING' && acts.some((a) => a.dealId === d.id && a.kind === 'VIEWING' && a.followUpAt && a.followUpAt < new Date(now.getTime() - 86_400_000)) && !acts.some((a) => a.dealId === d.id && a.happenedAt > (acts.filter((v) => v.dealId === d.id && v.kind === 'VIEWING').at(-1)?.followUpAt ?? now))).length,
    slaWarnings: slaWarn, slaEscalations: slaEsc,
  };
  // Звонки
  const calls = acts.filter((a) => a.kind === 'CALL');
  const phone = calls.filter((a) => a.source === 'PHONE');
  const callStats = { total: calls.length, logged: calls.length - phone.length, phone: phone.length, inbound: phone.filter((a) => a.callDirection === 'IN').length, outbound: phone.filter((a) => a.callDirection === 'OUT').length, missed: phone.filter((a) => /пропущен/i.test(a.note)).length, avgDurationSec: avg(phone.filter((a) => (a.durationSec ?? 0) > 0).map((a) => a.durationSec!)), withRecording: 0 };
  // Собственники
  const ownerRows = owners.map((o) => ({ stage: o.pipelineStage as OwnerStage, segment: ownerSegment(o.units.map((u) => ({ type: u.type, areaM2: Number(u.areaM2) }))) }));
  const ownerConv = ownerConversion(ownerRows).find((c) => c.segment === 'ALL');
  const ownersTouched = owners.filter((o) => o.stageChangedAt && o.stageChangedAt >= from).length;
  const ownersOverdue = owners.filter((o) => OWNER_ACTIVE_STAGES.includes(o.pipelineStage as OwnerStage) && o.nextActionAt && o.nextActionAt < now).length;
  return {
    period: { from, to: now, days },
    speed: { leads: deals.length, touched: touched.length, avgFirstTouchMin: avg(touched.map((x) => x.minutes)), medianFirstTouchMin: median(touched.map((x) => x.minutes)), within15Pct: deals.length ? Math.round((touched.filter((x) => x.minutes <= 15).length / deals.length) * 100) : null, bySource },
    staff,
    funnel: { leads: deals.length, viewings: reachedViewing, offers: reachedOffer, won, lost: deals.filter((d) => d.stage === 'LOST').length, leadToViewingPct: deals.length ? Math.round((reachedViewing / deals.length) * 100) : null, viewingToOfferPct: reachedViewing ? Math.round((reachedOffer / reachedViewing) * 100) : null, offerToWonPct: reachedOffer ? Math.round((won / reachedOffer) * 100) : null },
    quality, calls: callStats,
    owners: { total: owners.length, movedInPeriod: ownersTouched, overdue: ownersOverdue, signedPct: ownerConv?.pct ?? null, signed: ownerConv?.reached ?? 0 },
    activity: { total: human.length, byKind: (['CALL', 'VIEWING', 'OFFER', 'NOTE', 'FOLLOW_UP'] as const).map((k) => ({ kind: k, count: human.filter((a) => a.kind === k).length })), perDay: Math.round((human.length / Math.max(1, days)) * 10) / 10 },
  };
}
