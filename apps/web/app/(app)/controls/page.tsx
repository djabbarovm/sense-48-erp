import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can } from '@finance-os/core';
import { computeKpis, listKpiSnapshots } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Card, PageHeader, StatCard } from '@/components/ui';

export default async function ControlsPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'dashboard.ops')) notFound();
  const t = await getTranslations('controls');

  const [kpi, snapshots] = await Promise.all([computeKpis(ctx), listKpiSnapshots(ctx, 30)]);
  const trend = snapshots.map((snap) => ({
    date: snap.date.toISOString().slice(5, 10),
    metrics: snap.metrics as Record<string, number>,
  }));

  const cards: { key: keyof typeof kpi; tone: 'success' | 'danger' | 'warning' | 'default' }[] = [
    { key: 'urgentPct30d', tone: kpi.urgentPct30d > 10 ? 'danger' : 'success' },
    { key: 'greenFlowPct30d', tone: kpi.greenFlowPct30d >= 90 ? 'success' : 'warning' },
    { key: 'duplicatesPrevented30d', tone: 'default' },
    { key: 'openHolds', tone: kpi.openHolds > 0 ? 'warning' : 'success' },
    { key: 'exceptionsApproved30d', tone: 'default' },
    { key: 'apOverduePct', tone: kpi.apOverduePct > 20 ? 'danger' : 'default' },
    { key: 'arOverduePct', tone: kpi.arOverduePct > 20 ? 'danger' : 'default' },
    { key: 'docIssues', tone: kpi.docIssues > 0 ? 'warning' : 'success' },
    { key: 'overdueTasks', tone: kpi.overdueTasks > 0 ? 'danger' : 'success' },
    { key: 'autoFrozenBatches30d', tone: 'default' },
  ];
  const isPct = (key: string) => key.includes('Pct');

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />
      <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-5">
        {cards.map(({ key, tone }) => (
          <StatCard key={key} label={t(`kpi.${key}`)} value={`${kpi[key]}${isPct(key) ? '%' : ''}`} tone={tone} />
        ))}
      </div>

      {trend.length > 1 ? (
        <Card title={t('trendTitle')}>
          <div className="flex items-end gap-1" aria-hidden>
            {trend.map((point) => (
              <div key={point.date} className="flex w-full flex-col items-center gap-1">
                <div
                  className={`w-full rounded-t-sm ${(point.metrics.greenFlowPct30d ?? 0) >= 90 ? 'bg-volt-500/70' : 'bg-amber-400/70'}`}
                  style={{ height: `${Math.max(4, (point.metrics.greenFlowPct30d ?? 0) / 2)}px` }}
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">{t('trendHint')}</p>
        </Card>
      ) : (
        <p className="text-xs text-gray-400">{t('noTrend')}</p>
      )}
    </div>
  );
}
