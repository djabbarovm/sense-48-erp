import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Building2, CalendarClock, CheckCircle2, Clock, Flame, Phone, Plus, Send, Sparkles, UserPlus } from 'lucide-react';
import { DEAL_LOST_REASONS, DEAL_SOURCES, can } from '@finance-os/core';
import { getMyDay, prisma } from '@finance-os/db';
import { requireSessionUser, requireTenantContext } from '@/lib/session';
import { Badge, Button, Input, Select, cn } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';
import { OWNER_STAGE_TONE } from '../property/owners/tones';
import { issueTelegramLinkAction, ownerQuickCallAction, quickCallAction, quickLeadAction, scheduleViewingAction, taskDoneAction, unlinkTelegramAction, viewingResultAction } from './actions';

/* CRM Tower — «Мой день» (docs/21 §5, P-23): mobile-first экран сотрудника — показы, лиды, просрочки, собственники, задачи, быстрые действия. */

const fmtTime = (d: Date) => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });

export default async function MyDayPage({ searchParams }: { searchParams: Promise<{ error?: string; open?: string; tg?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'deal.view')) notFound();
  const user = await requireSessionUser();
  const sp = await searchParams;
  const t = await getTranslations('me'); const tD = await getTranslations('deals'); const tO = await getTranslations('owners');
  const day = await getMyDay(ctx);
  const tg = await prisma.user.findUnique({ where: { id: user.id }, select: { telegramChatId: true, telegramLinkCode: true, telegramLinkedAt: true } });
  const botName = process.env.TELEGRAM_BOT_USERNAME ?? null;
  const manage = can(ctx, 'deal.manage');
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 3600_000);
  const hour = Number(now.toLocaleTimeString('ru-RU', { hour: '2-digit', hour12: false, timeZone: 'Asia/Tashkent' }).slice(0, 2));
  const greeting = hour < 12 ? t('morning') : hour < 18 ? t('afternoon') : t('evening');
  const attention = day.newLeads.length + day.overdue.length + day.noNextAction.length + day.viewings.filter((v) => v.done).length;

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-4">
      <div>
        <h1 className="font-display text-xl font-bold text-ink-900">{greeting}, {user.fullName.split(/\s+/)[0]}</h1>
        <p className="text-sm text-gray-500">{fmtDate(now)} · {day.seesAll ? t('scopeAll') : t('scopeMine')}</p>
      </div>
      {sp.error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : t('error.GENERIC')}</div> : null}

      {/* Итог дня */}
      <div className="grid grid-cols-4 gap-2 text-center">
        {([['calls', day.today.calls], ['viewings', day.today.viewingsScheduled], ['leads', day.today.leads], ['active', day.pipeline.active]] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white px-2 py-2 shadow-sm ring-1 ring-gray-100"><p className="font-mono text-lg font-bold text-ink-900">{v}</p><p className="text-[10px] text-gray-500 uppercase tracking-wide">{t(`today.${k}`)}</p></div>
        ))}
      </div>
      {attention ? <p className="flex items-center gap-1.5 text-sm text-amber-700"><Flame className="h-4 w-4" />{t('attention', { n: attention })}</p> : <p className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" />{t('allClear')}</p>}

      {/* Быстрый лид */}
      {manage ? (
        <details className="rounded-lg bg-white shadow-sm ring-1 ring-gray-100" open={sp.open === 'lead'}>
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold"><UserPlus className="h-4 w-4 text-brand-500" />{t('lead.title')}</summary>
          <form action={quickLeadAction} className="grid gap-2 px-4 pb-4">
            <Input name="contactName" placeholder={t('lead.name')} required />
            <Input name="contactPhone" type="tel" placeholder={t('lead.phone')} />
            <div className="grid grid-cols-2 gap-2"><Input name="unitNo" placeholder={t('lead.unit')} /><Select name="source" defaultValue="WALK_IN">{DEAL_SOURCES.map((s) => (<option key={s} value={s}>{tD(`source.${s}`)}</option>))}</Select></div>
            <Input name="note" placeholder={t('lead.note')} />
            <Button type="submit" size="sm">{t('lead.create')}</Button>
          </form>
        </details>
      ) : null}

      {/* Показы */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><CalendarClock className="h-3.5 w-3.5" />{t('viewings.title')} · {day.viewings.length}</h2>
        {day.viewings.length === 0 ? <p className="text-sm text-gray-400">{t('viewings.none')}</p> : (
          <ul className="space-y-2">
            {day.viewings.map((v) => (
              <li key={v.activityId} className={cn('rounded-lg bg-white p-3 shadow-sm ring-1', v.done ? 'ring-amber-200' : v.at <= inOneHour && v.at >= now ? 'ring-brand-300' : 'ring-gray-100')}>
                <div className="flex items-center justify-between gap-2 text-sm"><span><span className="font-mono font-semibold">{fmtTime(v.at)}</span>{v.at < day.dayStart || v.at >= day.dayEnd ? <span className="ml-1 text-[10px] text-gray-400">{fmtDate(v.at)}</span> : null} <span className="ml-2 font-mono">{v.unitNo ?? '—'}</span> <span className="ml-2 text-gray-800">{v.contactName}</span></span><Link href={`/deals/${v.dealId}`} className="font-mono text-xs text-brand-600">{v.dealNumber}</Link></div>
                {v.note ? <p className="mt-1 text-xs text-gray-500">{v.note}</p> : null}
                {manage && v.at <= now ? (
                  <form action={viewingResultAction} className="mt-2 grid gap-1.5">
                    <input type="hidden" name="dealId" value={v.dealId} />
                    <p className="text-xs font-medium text-amber-700">{t('viewings.result')}</p>
                    <div className="grid grid-cols-2 gap-1.5"><Select name="result" defaultValue="THINKING">{(['OFFER', 'THINKING', 'RESCHEDULE', 'LOST'] as const).map((r) => (<option key={r} value={r}>{t(`viewings.r.${r}`)}</option>))}</Select><Input name="followUpAt" type="datetime-local" aria-label={t('viewings.when')} /></div>
                    <div className="grid grid-cols-2 gap-1.5"><Input name="expectedRate" type="number" placeholder={t('viewings.rate')} /><Select name="lostReason" defaultValue=""><option value="">{t('viewings.lostReason')}</option>{DEAL_LOST_REASONS.map((r) => (<option key={r} value={r}>{tD(`lost.${r}`)}</option>))}</Select></div>
                    <div className="flex gap-1.5"><Input name="note" placeholder={t('viewings.note')} className="flex-1" /><Button type="submit" size="sm">{t('save')}</Button></div>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Новые лиды */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><Sparkles className="h-3.5 w-3.5" />{t('leads.title')} · {day.newLeads.length}</h2>
        {day.newLeads.length === 0 ? <p className="text-sm text-gray-400">{t('leads.none')}</p> : <ul className="space-y-2">{day.newLeads.map((d) => <DealItem key={d.id} d={d} manage={manage} t={t} tD={tD} kind="lead" />)}</ul>}
      </section>

      {/* Просроченные и без шага */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><Clock className="h-3.5 w-3.5" />{t('overdue.title')} · {day.overdue.length + day.noNextAction.length}</h2>
        {day.overdue.length + day.noNextAction.length === 0 ? <p className="text-sm text-gray-400">{t('overdue.none')}</p> : <ul className="space-y-2">{[...day.overdue, ...day.noNextAction].map((d) => <DealItem key={d.id} d={d} manage={manage} t={t} tD={tD} kind={d.nextAction ? 'overdue' : 'nonext'} />)}</ul>}
      </section>

      {/* Сегодня по плану */}
      {day.dueToday.length ? (
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><CheckCircle2 className="h-3.5 w-3.5" />{t('dueToday.title')} · {day.dueToday.length}</h2>
          <ul className="space-y-2">{day.dueToday.map((d) => <DealItem key={d.id} d={d} manage={manage} t={t} tD={tD} kind="due" />)}</ul>
        </section>
      ) : null}

      {/* Собственники */}
      {day.owners.length ? (
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><Building2 className="h-3.5 w-3.5" />{t('owners.title')} · {day.owners.length}</h2>
          <ul className="space-y-2">
            {day.owners.map((o) => (
              <li key={o.id} className={cn('rounded-lg bg-white p-3 shadow-sm ring-1', o.overdue ? 'ring-red-200' : 'ring-gray-100')}>
                <div className="flex items-center justify-between gap-2 text-sm"><Link href={`/property/owners/${o.id}`} className="font-medium text-ink-900">{o.displayName}</Link><Badge tone={OWNER_STAGE_TONE[o.stage]}>{tO(`stage.${o.stage}`)}</Badge></div>
                <p className="mt-0.5 text-xs text-gray-500"><span className="font-mono">{o.unitNos.slice(0, 3).join(', ')}</span>{o.nextAction ? ` · ${o.nextAction}` : ` · ${t('owners.call')}`}{o.nextActionAt ? ` · ${fmtDate(o.nextActionAt)}` : ''}</p>
                {can(ctx, 'property.manage') ? (
                  <form action={ownerQuickCallAction} className="mt-2 flex gap-1.5"><input type="hidden" name="ownerId" value={o.id} /><Input name="note" placeholder={t('call.note')} required className="flex-1" /><Input name="followUpAt" type="date" className="w-36" aria-label={t('call.next')} /><Button type="submit" size="sm" variant="outline"><Phone className="h-4 w-4" /></Button></form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Задачи */}
      {day.tasks.length ? (
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><CheckCircle2 className="h-3.5 w-3.5" />{t('tasks.title')} · {day.tasks.length}</h2>
          <ul className="space-y-1.5">
            {day.tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-gray-100">
                <span><span className="text-gray-800">{task.nextAction}</span>{task.dueAt ? <span className={cn('ml-2 font-mono text-[10px]', task.dueAt < now ? 'text-red-600' : 'text-gray-400')}>{fmtDate(task.dueAt)}</span> : null}</span>
                <form action={taskDoneAction}><input type="hidden" name="taskId" value={task.id} /><Button type="submit" size="sm" variant="ghost" aria-label={t('tasks.done')}><CheckCircle2 className="h-4 w-4 text-emerald-600" /></Button></form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {/* Telegram (docs/21 §6) */}
      <section className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-gray-100">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Send className="h-4 w-4 text-sky-500" />{t('telegram.title')}</h2>
        {tg?.telegramChatId ? (
          <div className="mt-1 flex items-center justify-between gap-2 text-sm"><span className="text-emerald-700">{t('telegram.linked', { d: fmtDate(tg.telegramLinkedAt) })}</span><form action={unlinkTelegramAction}><Button type="submit" size="sm" variant="ghost">{t('telegram.unlink')}</Button></form></div>
        ) : tg?.telegramLinkCode && sp.tg ? (
          <div className="mt-1 text-sm">
            <p className="text-gray-700">{t('telegram.step')}</p>
            {botName ? <a href={`https://t.me/${botName}?start=${tg.telegramLinkCode}`} className="mt-2 inline-flex items-center gap-1 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white" target="_blank" rel="noreferrer"><Send className="h-4 w-4" />{t('telegram.open', { bot: botName })}</a> : <p className="mt-1 text-xs text-amber-700">{t('telegram.noBot')}</p>}
            <p className="mt-2 font-mono text-xs text-gray-600">/start {tg.telegramLinkCode}</p>
          </div>
        ) : (
          <div className="mt-1 flex items-center justify-between gap-2 text-sm"><span className="text-gray-600">{t('telegram.hint')}</span><form action={issueTelegramLinkAction}><Button type="submit" size="sm" variant="outline">{t('telegram.connect')}</Button></form></div>
        )}
      </section>
      <p className="text-center text-[11px] text-gray-400">{t('footer')}</p>
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<'me'>>>;
type TD = Awaited<ReturnType<typeof getTranslations<'deals'>>>;
type Deal = Awaited<ReturnType<typeof getMyDay>>['newLeads'][number];

function DealItem({ d, manage, t, tD, kind }: { d: Deal; manage: boolean; t: T; tD: TD; kind: 'lead' | 'overdue' | 'nonext' | 'due' }) {
  const tone = kind === 'lead' ? 'ring-brand-200' : kind === 'overdue' ? 'ring-red-200' : kind === 'nonext' ? 'ring-amber-200' : 'ring-gray-100';
  return (
    <li className={cn('rounded-lg bg-white p-3 shadow-sm ring-1', tone)}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span><Link href={`/deals/${d.id}`} className="font-medium text-ink-900">{d.contactName}</Link>{d.company ? <span className="ml-1 text-xs text-gray-500">{d.company}</span> : null}{d.unitNo ? <span className="ml-2 font-mono text-xs">{d.unitNo}</span> : null}</span>
        <span className="flex items-center gap-1.5"><Badge tone={kind === 'lead' ? 'blue' : 'gray'}>{tD(`stage.${d.stage}`)}</Badge>{d.contactPhone ? <a href={`tel:${d.contactPhone}`} className="rounded-full bg-emerald-50 p-1.5 text-emerald-700" aria-label={t('call.call')}><Phone className="h-4 w-4" /></a> : null}</span>
      </div>
      <p className="mt-0.5 text-xs text-gray-500">{tD(`source.${d.source}`)}{d.expectedRateMinor != null ? ` · ${fmtRate(d.expectedRateMinor, 'USD')}` : ''}{d.nextAction ? ` · ${d.nextAction}` : kind === 'nonext' ? ` · ${t('overdue.noNext')}` : ''}{d.nextActionAt ? ` · ${fmtDate(d.nextActionAt)}` : ''}</p>
      {manage ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-brand-600">{t('actions')}</summary>
          <div className="mt-2 grid gap-2">
            <form action={quickCallAction} className="grid gap-1.5 rounded-md bg-gray-50 p-2">
              <input type="hidden" name="dealId" value={d.id} />
              <p className="flex items-center gap-1 text-xs font-medium text-gray-700"><Phone className="h-3.5 w-3.5" />{t('call.title')}</p>
              <Input name="note" placeholder={t('call.note')} required />
              <div className="grid grid-cols-[1fr_auto_auto] gap-1.5"><Input name="nextAction" placeholder={t('call.next')} /><Input name="nextActionAt" type="date" className="w-36" aria-label={t('call.nextAt')} /><Button type="submit" size="sm" variant="outline">{t('save')}</Button></div>
            </form>
            <form action={scheduleViewingAction} className="grid gap-1.5 rounded-md bg-gray-50 p-2">
              <input type="hidden" name="dealId" value={d.id} />
              <p className="flex items-center gap-1 text-xs font-medium text-gray-700"><CalendarClock className="h-3.5 w-3.5" />{t('viewing.title')}</p>
              <div className="grid grid-cols-[1fr_auto_auto] gap-1.5"><Input name="at" type="datetime-local" required aria-label={t('viewing.when')} />{d.unitNo ? <input type="hidden" name="unitNo" value={d.unitNo} /> : <Input name="unitNo" placeholder={t('viewing.unit')} required className="w-24" />}<Button type="submit" size="sm" variant="outline"><Plus className="h-4 w-4" /></Button></div>
            </form>
          </div>
        </details>
      ) : null}
    </li>
  );
}
