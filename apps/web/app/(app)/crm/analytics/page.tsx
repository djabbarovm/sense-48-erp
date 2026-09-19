import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Activity, BarChart3, Gauge, Phone, ShieldAlert, Users } from 'lucide-react';
import { can } from '@finance-os/core';
import { getCrmAnalytics } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Card, PageHeader, Table, Td, Th, cn } from '@/components/ui';

/* P-26 — аналитика CRM (docs/21 §7): скорость, объём, конверсия, качество, звонки, собственники. */

const Kpi = ({ k, v, tone }: { k: string; v: string | number; tone?: string }) => (<div className="bg-white px-3 py-2.5"><p className="truncate text-[10px] font-semibold tracking-wider text-gray-500 uppercase">{k}</p><p className={cn('font-mono text-lg font-bold', tone ?? 'text-gray-900')}>{v}</p></div>);
const min = (m: number | null, t: (k: string, v?: Record<string, number>) => string) => (m == null ? '—' : m < 60 ? t('minutes', { n: m }) : t('hours', { n: Math.round(m / 6) / 10 }));

export default async function CrmAnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'deal.view')) notFound();
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const t = await getTranslations('crmAnalytics'); const tD = await getTranslations('deals');
  const a = await getCrmAnalytics(ctx, days);
  const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} meta={<span className="flex gap-1.5">{[7, 30, 90].map((d) => (<Link key={d} href={`/crm/analytics?days=${d}`} className={cn('rounded-md px-2.5 py-1 text-xs font-medium', d === days ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700')}>{t('days', { n: d })}</Link>))}</span>} actions={<Link href="/deals/analytics" className="text-sm text-brand-600 hover:underline">{t('funnelLink')}</Link>} />
      <p className="-mt-3 max-w-3xl text-sm text-gray-500">{t('intro')}</p>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi k={t('kpi.leads')} v={a.speed.leads} />
        <Kpi k={t('kpi.firstTouch')} v={min(a.speed.medianFirstTouchMin, t)} tone={a.speed.medianFirstTouchMin != null && a.speed.medianFirstTouchMin > 15 ? 'text-amber-600' : 'text-emerald-600'} />
        <Kpi k={t('kpi.within15')} v={pct(a.speed.within15Pct)} tone={a.speed.within15Pct != null && a.speed.within15Pct < 80 ? 'text-amber-600' : 'text-emerald-600'} />
        <Kpi k={t('kpi.activityPerDay')} v={a.activity.perDay} />
        <Kpi k={t('kpi.slaWarnings')} v={a.quality.slaWarnings} tone={a.quality.slaWarnings ? 'text-red-600' : 'text-gray-400'} />
        <Kpi k={t('kpi.won')} v={a.funnel.won} tone="text-emerald-600" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Gauge className="h-4 w-4 text-brand-500" />{t('speed.title')}</h3>
          <p className="mt-1 text-xs text-gray-500">{t('speed.hint')}</p>
          <Table>
            <thead><tr><Th>{t('speed.source')}</Th><Th className="text-right">{t('kpi.leads')}</Th><Th className="text-right">{t('speed.median')}</Th><Th className="text-right">{t('kpi.within15')}</Th><Th className="text-right">{t('speed.untouched')}</Th></tr></thead>
            <tbody>{a.speed.bySource.map((s) => (<tr key={s.source}><Td>{tD(`source.${s.source}`)}</Td><Td className="text-right font-mono">{s.leads}</Td><Td className="text-right font-mono">{min(s.medianMinutes, t)}</Td><Td className={cn('text-right font-mono', s.within15Pct != null && s.within15Pct < 80 ? 'text-amber-600' : '')}>{pct(s.within15Pct)}</Td><Td className={cn('text-right font-mono', s.untouched ? 'text-red-600' : 'text-gray-400')}>{s.untouched}</Td></tr>))}</tbody>
          </Table>
        </Card>
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><BarChart3 className="h-4 w-4 text-brand-500" />{t('funnel.title')}</h3>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            {([['leads', a.funnel.leads, null], ['viewings', a.funnel.viewings, a.funnel.leadToViewingPct], ['offers', a.funnel.offers, a.funnel.viewingToOfferPct], ['won', a.funnel.won, a.funnel.offerToWonPct]] as const).map(([k, v, p]) => (<div key={k} className="rounded-md bg-gray-50 px-2 py-2"><p className="font-mono text-xl font-bold">{v}</p><p className="text-[10px] text-gray-500 uppercase">{t(`funnel.${k}`)}</p>{p != null ? <p className="text-[11px] text-brand-700">{pct(p)}</p> : null}</div>))}
          </div>
          <p className="mt-2 text-[11px] text-gray-400">{t('funnel.hint', { lost: a.funnel.lost })}</p>
          <h4 className="mt-4 flex items-center gap-1 text-xs font-semibold text-gray-700"><Activity className="h-3.5 w-3.5" />{t('activity.title')}</h4>
          <ul className="mt-1 flex flex-wrap gap-2 text-xs">{a.activity.byKind.map((k) => (<li key={k.kind} className="rounded bg-gray-100 px-2 py-0.5">{tD(`activity.${k.kind}`)}: <span className="font-mono">{k.count}</span></li>))}</ul>
        </Card>
      </div>

      <Card>
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Users className="h-4 w-4 text-brand-500" />{t('staff.title')}</h3>
        <p className="mt-1 text-xs text-gray-500">{t('staff.hint')}</p>
        {a.staff.length === 0 ? <p className="mt-3 text-sm text-gray-400">{t('staff.none')}</p> : (
          <Table>
            <thead><tr><Th>{t('staff.name')}</Th><Th className="text-right">{t('kpi.leads')}</Th><Th className="text-right">{t('staff.calls')}</Th><Th className="text-right">{t('staff.viewings')}</Th><Th className="text-right">{t('staff.offers')}</Th><Th className="text-right">{t('staff.notes')}</Th><Th className="text-right">{t('staff.owners')}</Th><Th className="text-right">{t('staff.firstTouch')}</Th><Th className="text-right">{t('staff.active')}</Th><Th className="text-right">{t('staff.wonLost')}</Th></tr></thead>
            <tbody>{a.staff.map((s) => (<tr key={s.userId}><Td className="font-medium text-gray-900">{s.name}</Td><Td className="text-right font-mono">{s.leads}</Td><Td className="text-right font-mono">{s.calls}{s.phoneCalls ? <span className="text-[10px] text-gray-400"> ({s.phoneCalls}☎)</span> : null}</Td><Td className="text-right font-mono">{s.viewings}</Td><Td className="text-right font-mono">{s.offers}</Td><Td className="text-right font-mono">{s.notes}</Td><Td className="text-right font-mono">{s.ownerTouches}</Td><Td className={cn('text-right font-mono', s.avgFirstTouchMin != null && s.avgFirstTouchMin > 15 ? 'text-amber-600' : '')}>{min(s.avgFirstTouchMin, t)}</Td><Td className="text-right font-mono">{s.active}</Td><Td className="text-right font-mono"><span className="text-emerald-600">{s.won}</span> / <span className="text-red-600">{s.lost}</span></Td></tr>))}</tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><ShieldAlert className="h-4 w-4 text-red-500" />{t('quality.title')}</h3>
          <dl className="mt-3 space-y-1.5 text-sm">
            {([['noNextAction', a.quality.noNextAction], ['overdue', a.quality.overdue], ['stale7d', a.quality.stale7d], ['viewingsNoResult', a.quality.viewingsNoResult], ['slaWarnings', a.quality.slaWarnings], ['slaEscalations', a.quality.slaEscalations]] as const).map(([k, v]) => (<div key={k} className="flex justify-between"><dt className="text-gray-500">{t(`quality.${k}`)}</dt><dd className={cn('font-mono', v ? 'text-red-600' : 'text-gray-400')}>{v}</dd></div>))}
          </dl>
          <p className="mt-2 text-[11px] text-gray-400">{t('quality.hint')}</p>
        </Card>
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Phone className="h-4 w-4 text-brand-500" />{t('calls.title')}</h3>
          <dl className="mt-3 space-y-1.5 text-sm">
            {([['total', a.calls.total], ['logged', a.calls.logged], ['phone', a.calls.phone], ['inbound', a.calls.inbound], ['outbound', a.calls.outbound], ['missed', a.calls.missed]] as const).map(([k, v]) => (<div key={k} className="flex justify-between"><dt className="text-gray-500">{t(`calls.${k}`)}</dt><dd className="font-mono">{v}</dd></div>))}
            <div className="flex justify-between"><dt className="text-gray-500">{t('calls.avgDuration')}</dt><dd className="font-mono">{a.calls.avgDurationSec == null ? '—' : `${Math.round(a.calls.avgDurationSec / 60)} ${t('minShort')}`}</dd></div>
          </dl>
          <p className="mt-2 text-[11px] text-gray-400">{t('calls.hint')}</p>
        </Card>
        <Card>
          <h3 className="font-display text-sm font-semibold">{t('owners.title')}</h3>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500">{t('owners.total')}</dt><dd className="font-mono">{a.owners.total}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">{t('owners.moved')}</dt><dd className="font-mono">{a.owners.movedInPeriod}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">{t('owners.signed')}</dt><dd className="font-mono">{a.owners.signed} · {pct(a.owners.signedPct)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">{t('owners.overdue')}</dt><dd className={cn('font-mono', a.owners.overdue ? 'text-red-600' : 'text-gray-400')}>{a.owners.overdue}</dd></div>
          </dl>
          <Link href="/property/owners?view=analytics" className="mt-2 inline-block text-xs text-brand-600 hover:underline">{t('owners.link')}</Link>
        </Card>
      </div>
    </div>
  );
}
