import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { can, isActiveStage } from '@finance-os/core';
import { getFunnelAnalytics } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Card, PageHeader, Table, Td, Th, cn } from '@/components/ui';
import { fmtRate } from '@/components/property';

/* P-17 — аналитика воронки и атрибуция (blueprint §14): источник → лид → стадии → выигрыш/проигрыш. */

export default async function DealsAnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'deal.view')) notFound();
  const sp = await searchParams;
  const days = [30, 90, 180, 365].includes(Number(sp.days)) ? Number(sp.days) : 90;
  const t = await getTranslations('deals');
  const ta = await getTranslations('analytics');
  const a = await getFunnelAnalytics(ctx, days);
  const maxStage = Math.max(1, ...a.byStage.map((s) => s.count));

  return (
    <div className="space-y-5">
      <PageHeader
        title={ta('title')}
        meta={<span className="flex gap-1.5">{[30, 90, 180, 365].map((d) => (<Link key={d} href={`/deals/analytics?days=${d}`} className={cn('rounded-md px-2.5 py-1 text-xs font-medium', d === days ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>{ta('days', { n: d })}</Link>))}</span>}
        actions={<Link href="/deals" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"><ArrowLeft className="h-4 w-4" />{t('toBoard')}</Link>}
      />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { k: 'leads', v: a.totals.leads }, { k: 'active', v: a.totals.active }, { k: 'won', v: a.totals.won, tone: 'text-emerald-600' }, { k: 'lost', v: a.totals.lost, tone: 'text-red-600' },
          { k: 'winRate', v: `${a.totals.winRatePct}%`, tone: a.totals.winRatePct >= 30 ? 'text-emerald-600' : 'text-amber-600' }, { k: 'wonRent', v: fmtRate(a.totals.wonRentMinor, 'USD'), tone: 'text-emerald-600' },
        ].map((it) => (<div key={it.k} className="bg-white px-3 py-2.5"><p className="truncate text-[10px] font-semibold tracking-wider text-gray-500 uppercase">{ta(`kpi.${it.k}`)}</p><p className={cn('tnum mt-0.5 font-mono text-lg font-bold', it.tone ?? 'text-gray-900')}>{it.v}</p></div>))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><BarChart3 className="h-4 w-4 text-brand-500" />{ta('funnel')}</h3>
          <ul className="mt-3 space-y-1.5">
            {a.byStage.filter((s) => isActiveStage(s.stage) || s.count > 0).map((s) => (
              <li key={s.stage} className="flex items-center gap-2 text-xs">
                <span className="w-36 shrink-0 truncate text-gray-600">{t(`stage.${s.stage}`)}</span>
                <span className="h-4 flex-1 rounded-sm bg-gray-100"><span className={cn('block h-4 rounded-sm', s.stage === 'WON' ? 'bg-emerald-500' : s.stage === 'LOST' ? 'bg-red-400' : 'bg-brand-400')} style={{ width: `${Math.round((s.count / maxStage) * 100)}%` }} /></span>
                <span className="w-8 text-right font-mono">{s.count}</span>
                <span className="w-20 text-right font-mono text-gray-500">{s.potentialMinor > 0n ? fmtRate(s.potentialMinor, 'USD') : ''}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 text-center text-xs">
            <div><dt className="text-gray-500">{ta('avgToWon')}</dt><dd className="font-mono text-base font-semibold text-gray-900">{a.velocity.avgDaysToWon ?? '—'}</dd></div>
            <div><dt className="text-gray-500">{ta('avgToLost')}</dt><dd className="font-mono text-base font-semibold text-gray-900">{a.velocity.avgDaysToLost ?? '—'}</dd></div>
            <div><dt className="text-gray-500">{ta('medianInPipeline')}</dt><dd className="font-mono text-base font-semibold text-gray-900">{a.velocity.medianDaysInPipeline ?? '—'}</dd></div>
          </dl>
        </Card>
        <Card>
          <h3 className="font-display text-sm font-semibold">{ta('bySource')}</h3>
          <Table>
            <thead><tr><Th>{ta('source')}</Th><Th className="text-right">{ta('kpi.leads')}</Th><Th className="text-right">{ta('kpi.active')}</Th><Th className="text-right">{ta('kpi.won')}</Th><Th className="text-right">{ta('kpi.lost')}</Th><Th className="text-right">{ta('conversion')}</Th><Th className="text-right">{ta('kpi.wonRent')}</Th></tr></thead>
            <tbody>
              {a.bySource.length === 0 ? <tr><Td colSpan={7} className="text-center text-gray-400">—</Td></tr> : null}
              {a.bySource.map((s) => (<tr key={s.source}><Td>{t(`source.${s.source}`)}</Td><Td className="text-right font-mono">{s.leads}</Td><Td className="text-right font-mono">{s.active}</Td><Td className="text-right font-mono text-emerald-600">{s.won}</Td><Td className="text-right font-mono text-red-600">{s.lost}</Td><Td className="text-right font-mono">{s.conversionPct}%</Td><Td className="text-right font-mono">{fmtRate(s.wonRentMinor, 'USD')}</Td></tr>))}
            </tbody>
          </Table>
          {a.utmCampaigns.length ? (<div className="mt-3"><p className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{ta('campaigns')}</p><ul className="mt-1 divide-y divide-gray-100 text-xs">{a.utmCampaigns.map((c) => (<li key={c.campaign} className="flex justify-between py-1"><span className="font-mono">{c.campaign}</span><span className="font-mono text-gray-600">{c.leads} → {c.won}</span></li>))}</ul></div>) : null}
        </Card>
      </div>

      <Card>
        <h3 className="font-display text-sm font-semibold">{ta('lostReasons')}</h3>
        {a.lostReasons.length === 0 ? <p className="mt-2 text-sm text-gray-400">—</p> : (
          <ul className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {a.lostReasons.map((r) => (<li key={r.reason} className="rounded-md border border-gray-200 p-2 text-xs"><p className="font-medium text-gray-900">{t(`lost.${r.reason}`)}</p><p className="font-mono text-gray-600">{r.count} · {fmtRate(r.potentialMinor, 'USD')}</p></li>))}
          </ul>
        )}
      </Card>
    </div>
  );
}
