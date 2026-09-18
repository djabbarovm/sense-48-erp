import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertCircle, Plus } from 'lucide-react';
import { ACTIVE_DEAL_STAGES, can, type DealStage } from '@finance-os/core';
import { getPipelineSummary, listDealManagers, listDeals, type DealRow } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, PageHeader, Select, cn } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';

/* Wave 2 — доска сделок (docs/20 §11.2, blueprint §6): колонки по стадиям, сводка потенциальная/ожидаемая/подтверждённая. */

const STAGE_TONE: Record<DealStage, string> = {
  NEW: 'border-gray-300', QUALIFIED: 'border-gray-400', PROPERTY_SELECTED: 'border-sky-300', VIEWING: 'border-sky-500', OFFER: 'border-amber-300',
  NEGOTIATION: 'border-amber-500', LOI: 'border-orange-500', CONTRACT: 'border-emerald-500', MOVE_IN: 'border-emerald-600', WON: 'border-emerald-700', LOST: 'border-red-400',
};

function DealCard({ d, t }: { d: DealRow; t: Awaited<ReturnType<typeof getTranslations>> }) {
  return (
    <Link href={`/deals/${d.id}`} className={cn('block rounded-md border-l-4 bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md', STAGE_TONE[d.stage])}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[11px] text-gray-400">{d.number}</span>
        {d.attention.length ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label={t('attention')} /> : null}
      </div>
      <p className="mt-0.5 text-[13px] font-semibold text-gray-900">{d.company ?? d.contactName}</p>
      {d.company ? <p className="text-xs text-gray-500">{d.contactName}</p> : null}
      <p className="mt-1 text-xs text-gray-600">
        {d.unitNo ? <span className="font-mono font-semibold">{d.unitNo}</span> : <span className="text-gray-400">{t('noUnit')}</span>}
        {d.expectedRateMinor ? <span className="ml-2 font-mono">{fmtRate(d.expectedRateMinor, 'USD')}</span> : d.budgetMinor ? <span className="ml-2 font-mono text-gray-400">≈{fmtRate(d.budgetMinor, 'USD')}</span> : null}
      </p>
      <p className="mt-1 truncate text-[11px] text-gray-500">{d.nextAction ? `${fmtDate(d.nextActionAt)}: ${d.nextAction}` : t('noNextAction')}</p>
      <p className="mt-1 text-[10px] text-gray-400">{d.managerName} · {t(`source.${d.source}`)}</p>
    </Link>
  );
}

export default async function DealsBoardPage({ searchParams }: { searchParams: Promise<{ manager?: string; attention?: string; q?: string; closed?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'deal.view')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('deals');
  const filter = { ...(sp.manager ? { managerId: sp.manager } : {}), ...(sp.attention === '1' ? { attentionOnly: true } : {}), ...(sp.q ? { q: sp.q } : {}), ...(sp.closed === '1' ? { includeClosed: true } : {}) };
  const [deals, summary, managers] = await Promise.all([listDeals(ctx, filter), getPipelineSummary(ctx), listDealManagers(ctx)]);
  const stages: DealStage[] = sp.closed === '1' ? [...ACTIVE_DEAL_STAGES, 'WON', 'LOST'] : [...ACTIVE_DEAL_STAGES];
  const byStage = new Map<DealStage, DealRow[]>();
  for (const d of deals) byStage.set(d.stage, [...(byStage.get(d.stage) ?? []), d]);
  const tot = summary.totals;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        meta={<Badge tone={summary.attention ? 'red' : 'gray'} dot>{t('attentionCount', { n: summary.attention })}</Badge>}
        actions={can(ctx, 'deal.manage') ? <Link href="/deals/new"><Button size="sm"><Plus className="h-3.5 w-3.5" />{t('newDeal')}</Button></Link> : null}
      />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { k: 'active', v: tot.active },
          { k: 'potential', v: fmtRate(tot.potentialMinor, 'USD'), tone: 'text-gray-900' },
          { k: 'expected', v: fmtRate(tot.expectedMinor, 'USD'), tone: 'text-amber-600' },
          { k: 'confirmed', v: fmtRate(tot.confirmedMinor, 'USD'), tone: 'text-emerald-600' },
          { k: 'lostMonth', v: summary.lostThisMonth, tone: 'text-red-600' },
          { k: 'lostPotential', v: fmtRate(summary.lostPotentialMinor, 'USD'), tone: 'text-red-600' },
        ].map((it) => (
          <div key={it.k} className="bg-white px-3 py-2.5">
            <p className="truncate text-[10px] font-semibold tracking-wider text-gray-500 uppercase">{t(`kpi.${it.k}`)}</p>
            <p className={cn('tnum mt-0.5 truncate font-mono text-lg font-bold', it.tone ?? 'text-gray-900')}>{it.v}</p>
          </div>
        ))}
      </div>

      <Card>
        <form method="get" action="/deals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input name="q" defaultValue={sp.q ?? ''} placeholder={t('searchPlaceholder')} aria-label={t('search')} className="lg:col-span-2" />
          <Select name="manager" defaultValue={sp.manager ?? ''} aria-label={t('manager')}>
            <option value="">{t('allManagers')}</option>
            {managers.map((m) => (<option key={m.id} value={m.id}>{m.fullName}</option>))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="attention" value="1" defaultChecked={sp.attention === '1'} className="h-4 w-4" />{t('attentionOnly')}</label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="closed" value="1" defaultChecked={sp.closed === '1'} className="h-4 w-4" />{t('showClosed')}</label>
            <Button type="submit" size="sm" variant="outline">{t('apply')}</Button>
          </div>
        </form>
      </Card>

      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-3">
          {stages.map((stage) => {
            const list = byStage.get(stage) ?? [];
            const sum = list.reduce((s, d) => s + (d.expectedRateMinor ?? d.budgetMinor ?? 0n), 0n);
            return (
              <div key={stage} className="w-60 shrink-0 rounded-lg bg-gray-100/80 p-2">
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h3 className="text-[11px] font-semibold tracking-wider text-gray-600 uppercase">{t(`stage.${stage}`)}</h3>
                  <span className="font-mono text-[11px] text-gray-500">{list.length}{sum > 0n ? ` · ${fmtRate(sum, 'USD')}` : ''}</span>
                </div>
                <div className="space-y-2">
                  {list.length === 0 ? <p className="px-1 py-3 text-center text-[11px] text-gray-400">—</p> : list.map((d) => <DealCard key={d.id} d={d} t={t} />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
