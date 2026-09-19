/**
 * CRM Tower — Telegram-бот сотрудника (docs/21 §6, P-24).
 * Привязка: /start <code> (код из «Мой день»). Свободный текст → WorkBot-черновик → кнопка «Подтвердить» → commit сервисами (BR-P30).
 * Команды: /today /leads /deal <юнит|номер> /owners /help. Напоминания (BR-P59/P60): показ за час, результат показа через 2 ч,
 * SLA лида 15/30 мин; дайджесты 08:30 / 19:00 (Ташкент). Бот действует от имени сотрудника: права и аудит — его.
 */
import { randomBytes } from 'node:crypto';
import type { TenantContext } from '@finance-os/core';
import { PermissionDeniedError, ValidationError, can, hasRole, type RoleCode } from '@finance-os/core';
import type { TelegramBotApi, TgButton, TgUpdate } from '@finance-os/adapters';
import type { DealLostReason } from '@prisma/client';
import { withAudit } from '../audit.js';
import { prisma } from '../client.js';
import { buildTenantContext } from '../context.js';
import { confirmActionDraft, createActionDraft, rejectActionDraft } from './actionDrafts.js';
import { getMyDay, taskDone, viewingResult, type MyDay, type ViewingResult } from './myDay.js';
import { markProposalNotified, pendingProposalNotices } from './proposals.js';

const CRM_ROLES: RoleCode[] = ['COMMERCIAL_MANAGER', 'BROKER', 'CALL_CENTER', 'OWNER', 'MARKETING', 'FINANCE_OPS_LEAD', 'ADMIN'];
const appUrl = () => (process.env.APP_URL ?? '').replace(/\/$/, '');
const link = (path: string | null) => (path ? `${appUrl()}${path}` : '');
const tz = (d: Date) => new Date(d.getTime() + 5 * 3600_000);
const hhmm = (d: Date) => tz(d).toISOString().slice(11, 16);
const dmy = (d: Date) => { const l = tz(d); return `${String(l.getUTCDate()).padStart(2, '0')}.${String(l.getUTCMonth() + 1).padStart(2, '0')}`; };
const usd = (m: bigint | null) => (m == null ? '' : ` · $${(Number(m) / 100).toLocaleString('ru-RU')}`);

// ── Привязка ──

export async function issueTelegramLinkCode(userId: string): Promise<string> {
  const code = randomBytes(5).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8).toUpperCase();
  await prisma.user.update({ where: { id: userId }, data: { telegramLinkCode: code } });
  return code;
}

export async function linkTelegramChat(code: string, chatId: string): Promise<{ userId: string; fullName: string } | null> {
  const user = await prisma.user.findFirst({ where: { telegramLinkCode: code.trim().toUpperCase(), status: 'ACTIVE' }, select: { id: true, fullName: true } });
  if (!user) return null;
  await prisma.user.updateMany({ where: { telegramChatId: chatId, id: { not: user.id } }, data: { telegramChatId: null } }); // один чат — один сотрудник
  await prisma.user.update({ where: { id: user.id }, data: { telegramChatId: chatId, telegramLinkCode: null, telegramLinkedAt: new Date() } });
  const role = await prisma.userTenantRole.findFirst({ where: { userId: user.id }, select: { tenantId: true } });
  if (role) await withAudit({ tenantId: role.tenantId, userId: user.id }, async () => ({ result: null, audit: { action: 'user.telegram_link', objectType: 'user', objectId: user.id, after: { linked: true } } }));
  return { userId: user.id, fullName: user.fullName };
}

export async function unlinkTelegramChat(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { telegramChatId: null, telegramLinkCode: null, telegramLinkedAt: null } });
}

/** Контекст сотрудника по chat id: тенант, где у него CRM-роль (иначе первый). */
export async function contextForChat(chatId: string): Promise<TenantContext | null> {
  const user = await prisma.user.findFirst({ where: { telegramChatId: chatId, status: 'ACTIVE' }, select: { id: true } });
  if (!user) return null;
  const roles = await prisma.userTenantRole.findMany({ where: { userId: user.id }, include: { tenant: { select: { slug: true, status: true } } } });
  const pick = roles.find((r) => CRM_ROLES.includes(r.role as RoleCode) && r.tenant.status === 'ACTIVE') ?? roles.find((r) => r.tenant.status === 'ACTIVE');
  if (!pick) return null;
  return buildTenantContext(user.id, pick.tenant.slug);
}

// ── Тексты ──

export function digestText(day: MyDay, kind: 'morning' | 'evening' | 'now', name: string): string {
  const L: string[] = [];
  if (kind === 'morning') L.push(`☀️ Доброе утро, ${name}. План на ${dmy(day.dayStart)}:`);
  else if (kind === 'evening') L.push(`🌙 Итог дня, ${name}: звонков ${day.today.calls}, показов назначено ${day.today.viewingsScheduled}, лидов ${day.today.leads}. Завтра:`);
  else L.push(`📋 Мой день, ${dmy(day.dayStart)}:`);
  const todayV = day.viewings.filter((v) => v.at >= day.dayStart && v.at < day.dayEnd);
  L.push(`\n🏠 Показы (${todayV.length}):`); todayV.forEach((v) => L.push(`  ${hhmm(v.at)} ${v.unitNo ?? '—'} · ${v.contactName}${v.done ? ' — нужен результат' : ''}`)); if (!todayV.length) L.push('  —');
  L.push(`\n✨ Новые лиды (${day.newLeads.length}):`); day.newLeads.slice(0, 8).forEach((d) => L.push(`  ${d.contactName}${d.unitNo ? ` · ${d.unitNo}` : ''}${d.contactPhone ? ` · ${d.contactPhone}` : ''} — связаться`)); if (!day.newLeads.length) L.push('  —');
  const late = [...day.overdue, ...day.noNextAction];
  L.push(`\n⏰ Просрочено / без шага (${late.length}):`); late.slice(0, 8).forEach((d) => L.push(`  ${d.contactName}${d.unitNo ? ` · ${d.unitNo}` : ''} — ${d.nextAction ?? 'нет следующего шага'}${d.nextActionAt ? ` (${dmy(d.nextActionAt)})` : ''}`)); if (!late.length) L.push('  —');
  if (day.dueToday.length) { L.push(`\n✅ Сегодня по плану (${day.dueToday.length}):`); day.dueToday.slice(0, 8).forEach((d) => L.push(`  ${d.contactName}${d.unitNo ? ` · ${d.unitNo}` : ''} — ${d.nextAction}`)); }
  if (day.owners.length) { L.push(`\n🏢 Собственники (${day.owners.length}):`); day.owners.slice(0, 6).forEach((o) => L.push(`  ${o.displayName} · ${o.unitNos.slice(0, 2).join(', ')} — ${o.nextAction ?? 'первичный контакт'}${o.overdue ? ' ⚠️' : ''}`)); }
  if (day.tasks.length) L.push(`\n📌 Задач: ${day.tasks.length}`);
  L.push(`\nВ работе: ${day.pipeline.active} сделок${usd(day.pipeline.potentialMinor)}/мес потенциал. ${link('/me')}`);
  return L.join('\n');
}

const HELP = ['Пишите как коллеге — я превращу в запись и спрошу подтверждение:', '• лид +998 90 123 45 67 Алиев, 2к до 1500', '• показ 1204 завтра 15:00 Алиев', '• показ 1204 прошёл, хотят оффер 1400', '• позвонил Каримову, перезвонить в пятницу', '• собственник 1507 показал расчёт, думает до среды', '• 1704 освободился, можно выставлять', '', 'Команды: /today — мой день, /leads — новые лиды, /deal 1204 — сделка по юниту, /owners — собственники на связь, /help'].join('\n');

// ── Обработка апдейта ──

export interface BotReply { chatId: string; text: string; keyboard?: TgButton[][] }

async function reply(api: TelegramBotApi, chatId: string, text: string, keyboard?: TgButton[][]): Promise<BotReply> {
  await api.sendMessage(chatId, text, keyboard ? { keyboard } : {});
  return { chatId, text, ...(keyboard ? { keyboard } : {}) };
}

export async function handleTelegramUpdate(update: TgUpdate, api: TelegramBotApi, now = new Date()): Promise<BotReply | null> {
  if (update.callback_query) return handleCallback(update.callback_query, api, now);
  const msg = update.message;
  if (!msg?.text) return null;
  const chatId = String(msg.chat.id);
  const text = msg.forward_from || msg.forward_sender_name ? `лид ${msg.forward_from ? `${msg.forward_from.first_name ?? ''} ${msg.forward_from.last_name ?? ''}`.trim() : msg.forward_sender_name}: ${msg.text}` : msg.text.trim();
  const start = text.match(/^\/start(?:\s+(\S+))?/);
  if (start) {
    if (!start[1]) return reply(api, chatId, 'Это рабочий бот MDS. Чтобы подключить чат, откройте «Мой день» в приложении → «Подключить Telegram» и перейдите по ссылке.');
    const user = await linkTelegramChat(start[1], chatId);
    if (!user) return reply(api, chatId, 'Код не найден или уже использован. Получите новую ссылку в «Мой день».');
    return reply(api, chatId, `Готово, ${user.fullName.split(/\s+/)[0]}! Чат подключён.\n\n${HELP}`);
  }
  const ctx = await contextForChat(chatId);
  if (!ctx) return reply(api, chatId, 'Чат не привязан к сотруднику. Откройте «Мой день» → «Подключить Telegram».');
  if (/^\/help/.test(text)) return reply(api, chatId, HELP);
  try {
    if (/^\/(today|me)\b/.test(text) || /^(мой день|что сегодня)$/i.test(text)) {
      const day = await getMyDay(ctx, now);
      const name = (await prisma.user.findUnique({ where: { id: ctx.userId }, select: { fullName: true } }))?.fullName.split(/\s+/)[0] ?? '';
      return reply(api, chatId, digestText(day, 'now', name));
    }
    if (/^\/leads\b/.test(text)) {
      const day = await getMyDay(ctx, now);
      return reply(api, chatId, day.newLeads.length ? `✨ Новые лиды:\n${day.newLeads.map((d) => `• ${d.contactName}${d.unitNo ? ` · ${d.unitNo}` : ''}${d.contactPhone ? ` · ${d.contactPhone}` : ''} · ${d.source} ${link(`/deals/${d.id}`)}`).join('\n')}` : 'Новых лидов нет.');
    }
    if (/^\/owners\b/.test(text)) {
      const day = await getMyDay(ctx, now);
      return reply(api, chatId, day.owners.length ? `🏢 Собственники на связь:\n${day.owners.map((o) => `• ${o.displayName} · ${o.unitNos.slice(0, 3).join(', ')} — ${o.nextAction ?? 'первичный контакт'}${o.overdue ? ' ⚠️' : ''} ${link(`/property/owners/${o.id}`)}`).join('\n')}` : 'Собственников на сегодня нет.');
    }
    const dealCmd = text.match(/^\/deal\s+(\S+)/);
    if (dealCmd) {
      const q = dealCmd[1]!;
      const deal = await prisma.deal.findFirst({ where: { tenantId: ctx.tenantId, OR: [{ number: { equals: q, mode: 'insensitive' } }, { unit: { unitNo: { equals: q, mode: 'insensitive' } } }], ...(hasRole(ctx, 'BROKER') && !can(ctx, 'unit.owner.view') ? { managerId: ctx.userId } : {}) }, orderBy: { updatedAt: 'desc' }, include: { unit: { select: { unitNo: true } } } });
      if (!deal) return reply(api, chatId, `Сделка по «${q}» не найдена.`);
      const acts = await prisma.unitActivity.findMany({ where: { dealId: deal.id }, orderBy: { happenedAt: 'desc' }, take: 3 });
      const pii = can(ctx, 'deal.contact.view');
      return reply(api, chatId, `${deal.number} · ${deal.stage}\n${deal.contactName}${pii && deal.contactPhone ? ` · ${deal.contactPhone}` : ''}${deal.unit ? ` · юнит ${deal.unit.unitNo}` : ''}${usd(deal.expectedRateMinor)}\nСледующий шаг: ${deal.nextAction ?? '—'}${deal.nextActionAt ? ` (${dmy(deal.nextActionAt)} ${hhmm(deal.nextActionAt)})` : ''}\n${acts.map((a) => `· ${dmy(a.happenedAt)} ${a.kind}: ${a.note.slice(0, 80)}`).join('\n')}\n${link(`/deals/${deal.id}`)}`, deal.stage === 'VIEWING' ? [viewingButtons(deal.id)] : undefined);
    }
    // Свободный текст → черновик WorkBot
    const draft = await createActionDraft(ctx, { text, source: 'TELEGRAM' }, undefined, now);
    if (draft.status === 'NEEDS_INFO') return reply(api, chatId, `🤔 ${draft.preview}\n\n${HELP.split('\n').slice(0, 7).join('\n')}`);
    if (draft.kind === 'QUERY_UNITS' || draft.kind === 'QUERY_MY_DAY') {
      const done = await confirmActionDraft(ctx, draft.id);
      if (draft.kind === 'QUERY_MY_DAY') { const day = await getMyDay(ctx, now); return reply(api, chatId, digestText(day, 'now', '')); }
      return reply(api, chatId, `${draft.preview}\n${link(done.resultRef)}`);
    }
    return reply(api, chatId, `📝 ${draft.preview}\n\nПодтвердить?`, [[{ text: '✅ Подтвердить', data: `d:c:${draft.id}` }, { text: '✖ Отмена', data: `d:r:${draft.id}` }]]);
  } catch (e) {
    if (e instanceof ValidationError) return reply(api, chatId, `Не получилось: ${e.code}`);
    if (e instanceof PermissionDeniedError) return reply(api, chatId, 'Недостаточно прав для этого действия.');
    throw e;
  }
}

const viewingButtons = (dealId: string): TgButton[] => [{ text: '👍 Оффер', data: `v:${dealId}:OFFER` }, { text: '🤔 Думают', data: `v:${dealId}:THINKING` }, { text: '📅 Перенос', data: `v:${dealId}:RESCHEDULE` }, { text: '✖ Отказ', data: `v:${dealId}:LOST` }];
const LOST_REASONS: [DealLostReason, string][] = [['PRICE', 'Цена'], ['TIMING', 'Сроки'], ['LOCATION', 'Локация'], ['COMPETITOR', 'Конкурент'], ['NO_RESPONSE', 'Не отвечает'], ['OTHER', 'Другое']];

async function handleCallback(cb: NonNullable<TgUpdate['callback_query']>, api: TelegramBotApi, now: Date): Promise<BotReply | null> {
  const chatId = String(cb.message?.chat.id ?? cb.from.id);
  await api.answerCallback(cb.id);
  const ctx = await contextForChat(chatId);
  if (!ctx) return reply(api, chatId, 'Чат не привязан к сотруднику.');
  const [kind, a, b] = (cb.data ?? '').split(':');
  try {
    if (kind === 'd' && a === 'c' && b) { const d = await confirmActionDraft(ctx, b); return reply(api, chatId, d.status === 'CONFIRMED' ? `✅ Сделано. ${link(d.resultRef)}` : `⚠️ Не выполнено: ${d.error ?? d.status}`); }
    if (kind === 'd' && a === 'r' && b) { await rejectActionDraft(ctx, b, 'Отменено в Telegram'); return reply(api, chatId, 'Отменено.'); }
    if (kind === 'v' && a && b) {
      if (b === 'LOST') return reply(api, chatId, 'Причина отказа?', [LOST_REASONS.slice(0, 3).map(([r, t]) => ({ text: t, data: `vl:${a}:${r}` })), LOST_REASONS.slice(3).map(([r, t]) => ({ text: t, data: `vl:${a}:${r}` }))]);
      if (b === 'RESCHEDULE') return reply(api, chatId, 'Напишите новую дату показа, например: «показ 1204 завтра 15:00».');
      await viewingResult(ctx, a, { result: b as ViewingResult }, now);
      return reply(api, chatId, b === 'OFFER' ? '👍 Записал: готовим оффер, следующий шаг — отправить оффер завтра. Ставку можно уточнить в карточке.' : '🤔 Записал: клиент думает, напомню через 2 дня.');
    }
    if (kind === 'vl' && a && b) { await viewingResult(ctx, a, { result: 'LOST', lostReason: b as DealLostReason }, now); return reply(api, chatId, '✖ Сделка закрыта c причиной. Спасибо, это учтётся в аналитике отказов.'); }
    if (kind === 't' && a) { await taskDone(ctx, a); return reply(api, chatId, '✅ Задача закрыта.'); }
    return reply(api, chatId, 'Неизвестное действие.');
  } catch (e) {
    if (e instanceof ValidationError) return reply(api, chatId, `Не получилось: ${e.code}`);
    if (e instanceof PermissionDeniedError) return reply(api, chatId, 'Недостаточно прав.');
    throw e;
  }
}

// ── Рассылки: дайджесты и напоминания ──

async function crmRecipients(tenantId: string, roles?: RoleCode[]) {
  const rows = await prisma.userTenantRole.findMany({ where: { tenantId, role: { in: (roles ?? CRM_ROLES) as never[] }, user: { telegramChatId: { not: null }, status: 'ACTIVE' } }, include: { user: { select: { id: true, fullName: true, telegramChatId: true } }, tenant: { select: { slug: true } } }, distinct: ['userId'] });
  return rows.map((r) => ({ userId: r.user.id, name: r.user.fullName.split(/\s+/)[0] ?? '', chatId: r.user.telegramChatId!, slug: r.tenant.slug }));
}

export async function sendCrmDigests(tenantId: string, now: Date, api: TelegramBotApi, kind: 'morning' | 'evening'): Promise<number> {
  let n = 0;
  for (const r of await crmRecipients(tenantId)) {
    const ctx = await buildTenantContext(r.userId, r.slug);
    if (!can(ctx, 'deal.view')) continue;
    const day = await getMyDay(ctx, kind === 'evening' ? new Date(now.getTime() + 86_400_000 - 5 * 3600_000) : now);
    await api.sendMessage(r.chatId, digestText(kind === 'evening' ? { ...day, today: (await getMyDay(ctx, now)).today } : day, kind, r.name));
    n++;
  }
  return n;
}

const marked = async (tenantId: string, type: string, objectId: string) => (await prisma.domainEvent.count({ where: { tenantId, type, objectId } })) > 0;
const mark = (tenantId: string, type: string, objectType: string, objectId: string, now: Date) => prisma.domainEvent.create({ data: { tenantId, type, objectType, objectId, payload: {}, deliveredAt: now } });
const workingHours = (now: Date) => { const h = tz(now).getUTCHours(); return h >= 9 && h < 20; };

/** Джоб crm-reminders (каждые 15 мин): показ за час; результат показа через 2 ч; SLA лида 15/30 мин (BR-P59, BR-P60). */
export async function sendCrmReminders(tenantId: string, now: Date, api: TelegramBotApi): Promise<number> {
  let n = 0;
  const chatOf = new Map((await crmRecipients(tenantId)).map((r) => [r.userId, r.chatId]));
  const send = async (userId: string, text: string, keyboard?: TgButton[][]) => { const chat = chatOf.get(userId); if (!chat) return false; await api.sendMessage(chat, text, keyboard ? { keyboard } : {}); n++; return true; };
  // 1. Показ через ≤ 60 минут
  const soon = await prisma.unitActivity.findMany({ where: { tenantId, kind: 'VIEWING', followUpAt: { gt: now, lte: new Date(now.getTime() + 3600_000) }, deal: { stage: { notIn: ['WON', 'LOST'] } } }, include: { deal: { select: { id: true, managerId: true, contactName: true, contactPhone: true } }, unit: { select: { unitNo: true } } } });
  for (const a of soon) {
    if (!a.deal || (await marked(tenantId, 'viewing.reminder', a.id))) continue;
    await mark(tenantId, 'viewing.reminder', 'unit_activity', a.id, now);
    await send(a.deal.managerId, `⏰ Через час показ: ${hhmm(a.followUpAt!)} · ${a.unit?.unitNo ?? '—'} · ${a.deal.contactName}${a.deal.contactPhone ? ` · ${a.deal.contactPhone}` : ''}\n${link(`/deals/${a.deal.id}`)}`);
  }
  // 2. Показ прошёл ≥ 2 часа назад, сделка всё ещё VIEWING и активности после показа нет → спросить результат
  const passed = await prisma.unitActivity.findMany({ where: { tenantId, kind: 'VIEWING', followUpAt: { lt: new Date(now.getTime() - 2 * 3600_000), gt: new Date(now.getTime() - 3 * 86_400_000) }, deal: { stage: 'VIEWING' } }, include: { deal: { select: { id: true, managerId: true, contactName: true } }, unit: { select: { unitNo: true } } } });
  for (const a of passed) {
    if (!a.deal || (await marked(tenantId, 'viewing.result.prompt', a.id))) continue;
    const later = await prisma.unitActivity.count({ where: { dealId: a.deal.id, happenedAt: { gt: a.followUpAt! } } });
    if (later) continue;
    await mark(tenantId, 'viewing.result.prompt', 'unit_activity', a.id, now);
    await send(a.deal.managerId, `Как прошёл показ ${a.unit?.unitNo ?? ''} · ${a.deal.contactName} (${hhmm(a.followUpAt!)})?`, [viewingButtons(a.deal.id)]);
  }
  // 3. SLA лида (BR-P59): NEW без касания сотрудника 15 мин → менеджер; 30 мин → руководитель. Только в рабочее время.
  if (workingHours(now)) {
    const fresh = await prisma.deal.findMany({ where: { tenantId, stage: 'NEW', createdAt: { lt: new Date(now.getTime() - 15 * 60_000), gt: new Date(now.getTime() - 2 * 86_400_000) } }, select: { id: true, managerId: true, contactName: true, source: true, createdAt: true } });
    const owners = await crmRecipients(tenantId, ['OWNER']);
    const callCenter = await crmRecipients(tenantId, ['CALL_CENTER']);
    for (const d of fresh) {
      const touched = await prisma.unitActivity.count({ where: { dealId: d.id, source: { not: 'API' } } });
      if (touched) continue;
      const mins = Math.floor((now.getTime() - d.createdAt.getTime()) / 60_000);
      if (!(await marked(tenantId, 'lead.sla.warn', d.id))) { await mark(tenantId, 'lead.sla.warn', 'deal', d.id, now); const warn = `🔔 Лид без ответа ${mins} мин: ${d.contactName} (${d.source}). Свяжитесь и напишите мне «позвонил ${d.contactName.split(/\s+/)[0]}…».\n${link(`/deals/${d.id}`)}`; await send(d.managerId, warn); for (const c of callCenter) if (c.userId !== d.managerId) await send(c.userId, warn); }
      if (mins >= 30 && !(await marked(tenantId, 'lead.sla.escalate', d.id))) { await mark(tenantId, 'lead.sla.escalate', 'deal', d.id, now); for (const o of owners) if (o.userId !== d.managerId) await send(o.userId, `🚨 Лид ${d.contactName} без касания ${mins} мин (менеджер не ответил). ${link(`/deals/${d.id}`)}`); }
    }
  }
  // 4. КП: клиент открыл / запросил показ (P-28)
  for (const pn of await pendingProposalNotices(tenantId)) {
    if (pn.requested) { await send(pn.managerId, `📩 ${pn.contactName} запросил показ по КП${pn.requestNote ? `: «${pn.requestNote}»` : ''}. Назначьте: «показ <юнит> завтра 15:00 ${pn.contactName.split(/\s+/)[0]}».\n${link(`/deals/${pn.dealId}`)}`); await markProposalNotified(pn.id, { requested: true, viewed: true }, now); continue; }
    if (pn.viewed) { await send(pn.managerId, `👀 ${pn.contactName} открыл КП (просмотров: ${pn.viewsCount}). Хороший момент позвонить.\n${link(`/deals/${pn.dealId}`)}`); await markProposalNotified(pn.id, { viewed: true }, now); }
  }
  return n;
}
