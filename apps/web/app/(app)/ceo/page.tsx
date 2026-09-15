import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Sun, CalendarDays, Wallet, AlertTriangle, ArrowRight, Sparkles } from 'lucide-react';
import { can, formatMoney, money } from '@finance-os/core';
import { getTranslations } from 'next-intl/server';
import { getMorning, type BreakEven } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Card, PageHeader } from '@/components/ui';

/* H-07: окно «Утро» по docs/15-ceo-path.md — четыре вопроса CEO за 3–5 минут. */

const fmt = (v: bigint) => formatMoney(money(v, 'UZS'));
const fmtM = (v: bigint) => `${(v / 100_000_000n).toLocaleString('ru-RU')} млн`;
const d = (x: Date | string | null | undefined) => (x ? new Date(x).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—');

function BreakEvenCard({ be, title, t }: { be: BreakEven; title: string; t: Awaited<ReturnType<typeof getTranslations>> }) {
  if (!be.fixedFilled) {
    return (
      <Card className="border-amber-300 bg-amber-50">
        <h3 className="font-display text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-gray-600">
          {t('beNotConfigured')}
        </p>
        <Link href="/ceo/settings" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-600">
          {t('fill')} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Card>
    );
  }
  const tone = be.passedFact ? 'text-emerald-600' : be.passedForecast ? 'text-amber-600' : 'text-red-600';
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-semibold">{title}</h3>
        <span className={`font-mono text-xs font-semibold ${tone}`}>
          {be.passedFact ? t('bePassedFact') : be.passedForecast ? t('bePassForecast', { date: d(be.passDateForecast) }) : t('beNotPassing')}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${be.passedFact ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${Math.min(100, be.progressPct)}%` }} />
      </div>
      <dl className="mt-3 space-y-1 text-[13px]">
        <div className="flex justify-between"><dt className="text-gray-500">{t('beRequired')}</dt><dd className="font-mono">{fmt(be.requiredRevenueMinor)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">{t('beActual')}</dt><dd className="font-mono">{fmt(be.revenueActualMinor)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">{t('beCovered')}</dt><dd className={`font-mono ${tone}`}>{be.progressPct}%</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">{t('beConfirmed')}</dt><dd className="font-mono">{fmt(be.revenueConfirmedFutureMinor)}</dd></div>
        <div className="flex justify-between"><dt className="text-gray-500">{t('beProfit')}</dt><dd className={`font-mono ${be.profitForecastMinor >= 0n ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(be.profitForecastMinor)}</dd></div>
      </dl>
    </Card>
  );
}

export default async function CeoMorningPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'dashboard.owner')) notFound();
  const t = await getTranslations('ceo');
  const m = await getMorning(ctx);
  const near = m.nearestEvent;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        meta={`${new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })} · ${t('metaSuffix')}`}
        actions={<Link href="/ceo/settings" className="text-sm text-brand-600">{t('settingsLink')}</Link>}
      />

      {/* 1 · Итог одной строкой */}
      <Card className="border-ink-700 bg-ink-900 text-white">
        <div className="flex items-start gap-3">
          <Sun className="mt-0.5 h-5 w-5 shrink-0 text-volt" />
          <div className="space-y-1 text-[15px] leading-relaxed">
            {m.summary.map((s, i) => (<p key={i}>{s}</p>))}
          </div>
        </div>
      </Card>

      {/* 2 · Точка безубыточности */}
      <section>
        <h2 className="mb-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase">{t('beSection')} · {m.period}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <BreakEvenCard be={m.rooftop} title="Rooftop Hall" t={t} />
          <BreakEvenCard be={m.sense} title="Sense 48" t={t} />
        </div>
      </section>

      {/* 3 · Загрузка */}
      <section>
        <h2 className="mb-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase">{t('loadSection')}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('rooftopCal')}</h3></div>
            <dl className="mt-3 space-y-1 text-[13px]">
              <div className="flex justify-between"><dt className="text-gray-500">{t('busyMonth')}</dt><dd className="font-mono">{m.occupancy.monthBusy} / {m.occupancy.monthDays}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t('busyAhead')}</dt><dd className="font-mono">{m.occupancy.monthBusyAhead} / {m.occupancy.monthDaysAhead}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t('confirmed306090')}</dt><dd className="font-mono">{m.occupancy.confirmed30} / {m.occupancy.confirmed60} / {m.occupancy.confirmed90}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t('prelim30')}</dt><dd className="font-mono">{m.occupancy.prelim30}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t('free30')}</dt><dd className="font-mono">{m.occupancy.freeSellable30}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t('moneyLoad')}</dt><dd className="font-mono font-semibold">{fmt(m.occupancy.moneyLoadMinor)}</dd></div>
            </dl>
          </Card>
          <Card>
            <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('senseToday')}</h3></div>
            {m.senseToday.stat ? (
              <dl className="mt-3 space-y-1 text-[13px]">
                <div className="flex justify-between"><dt className="text-gray-500">{t('visitsPlanned')}</dt><dd className="font-mono">{m.senseToday.stat.visitsPlanned ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">{t('loadExpected')}</dt><dd className="font-mono">{m.senseToday.stat.loadPct != null ? `${m.senseToday.stat.loadPct}%` : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">{t('revenueExpected')}</dt><dd className="font-mono">{fmt(m.senseToday.stat.revenueMinor)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">{t('cancellations')}</dt><dd className="font-mono">{m.senseToday.stat.cancellations}</dd></div>
                {m.senseToday.stat.notes ? <p className="pt-1 text-gray-600">{m.senseToday.stat.notes}</p> : null}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-gray-500">{t('noSenseStat')}</p>
            )}
          </Card>
        </div>
      </section>

      {/* 4 · Ближайшее мероприятие */}
      <section>
        <h2 className="mb-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase">{t('eventSection')}  · {t('weekMeta', { events: m.week.events, guests: m.week.guests, revenue: fmtM(m.week.revenueMinor), risks: m.week.risks })}</h2>
        {near ? (
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-base font-semibold">{near.name}</h3>
              <span className="font-mono text-sm text-gray-500">{d(near.date)}{near.startTime ? ` · ${near.startTime}` : ''}</span>
            </div>
            <dl className="mt-3 grid gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2">
              <div className="flex justify-between"><dt className="text-gray-500">{t('client')}</dt><dd>{near.customerName ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t('formatGuests')}</dt><dd className="font-mono">{near.format} · {near.guests ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t('contractSum')}</dt><dd className="font-mono">{fmt(near.contractMinor)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t('depositRest')}</dt><dd className="font-mono">{fmt(near.depositMinor)} / {fmt(near.restMinor)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t('readiness')}</dt><dd>{near.openTasks === 0 ? <Badge tone="green">{t('noTasks')}</Badge> : <Badge tone="yellow">{t('openTasks', { n: near.openTasks })}</Badge>}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t('responsible')}</dt><dd>{near.ownerName ?? '—'}</dd></div>
            </dl>
            {near.riskNote ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-2 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t('mainRisk', { risk: near.riskNote })}</p>
            ) : near.depositMinor === 0n ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t('noDeposit')}</p>
            ) : null}
            <Link href={`/events/${near.id}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600">{t('eventCard')} <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Card>
        ) : (
          <Card><p className="text-sm text-gray-500">{t('noEvents')}</p></Card>
        )}
      </section>

      {/* 6 · Деньги */}
      <section>
        <h2 className="mb-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase">{t('moneySection')}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <div className="flex items-center gap-2"><Wallet className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('balances')}</h3></div>
            <dl className="mt-3 space-y-1 text-[13px]">
              {m.money.accounts.map((a) => (
                <div key={a.name} className="flex justify-between"><dt className="text-gray-500">{a.name}</dt><dd className="font-mono">{fmt(a.balanceMinor)}</dd></div>
              ))}
              <div className="flex justify-between border-t border-gray-100 pt-1"><dt className="font-medium">{t('total')}</dt><dd className="font-mono font-semibold">{fmt(m.money.totalMinor)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t('willGo')}</dt><dd className="font-mono text-red-600">−{fmt(m.money.due7Minor)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{t('willCome')}</dt><dd className="font-mono text-emerald-600">+{fmt(m.money.expectedInMinor)}</dd></div>
              <div className="flex justify-between"><dt className="font-medium">{t('freeRest')}</dt><dd className="font-mono font-semibold">{fmt(m.money.freeMinor)}</dd></div>
            </dl>
          </Card>
          <Card>
            <h3 className="font-display text-sm font-semibold">{t('overdueAr')}</h3>
            {m.money.topOverdueAr.length ? (
              <dl className="mt-3 space-y-1 text-[13px]">
                {m.money.topOverdueAr.map((r) => (
                  <div key={r.name} className="flex justify-between"><dt className="text-gray-500">{r.name}</dt><dd className="font-mono text-red-600">{fmt(r.amountMinor)}</dd></div>
                ))}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-gray-500">{t('noOverdue')}</p>
            )}
            <Link href="/ar" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-600">{t('allAr')} <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Card>
        </div>
      </section>

      {/* 7 · Решения */}
      <section>
        <h2 className="mb-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase">{t('decisionsSection')}</h2>
        {m.decisions.length === 0 ? (
          <Card className="border-emerald-200 bg-emerald-50"><p className="text-sm font-medium text-emerald-700">{t('noDecisions')}</p></Card>
        ) : (
          <div className="space-y-2">
            {m.decisions.map((dec, i) => (
              <Card key={i} className="border-red-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{dec.what}</p>
                    <p className="text-xs text-gray-500">
                      {t('impact')} <span className="font-mono">{fmt(dec.impactMinor)}</span>
                      {dec.deadline ? ` · ${t('deadline')} ${dec.deadline}` : ''} · {dec.recommendation}
                    </p>
                  </div>
                  <Link href={dec.href} className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-semibold text-white">{t('decide')}</Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
