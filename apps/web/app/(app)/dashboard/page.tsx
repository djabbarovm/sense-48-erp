import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { can, formatMoney, money } from '@finance-os/core';
import {
  HEALTH_ZONES,
  getApAging,
  getArAging,
  getCashForecast,
  getCashPosition,
  getDocumentHealth,
  getEventPl,
  listBatches,
  listBudgetMatrix,
  listEvents,
  listTaxObligations,
  prisma,
} from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Card, Meter, PageHeader, StatCard } from '@/components/ui';

const fmt = (v: bigint) => formatMoney(money(v, 'UZS'));

export default async function OwnerDashboardPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'dashboard.owner')) notFound();
  const t = await getTranslations('ownerDash');
  const now = new Date();
  const today = new Date(now.toISOString().slice(0, 10));

  const [cash, forecast, batches, apAging, arAging, taxes, events, health, budget, advancesNoDocs] =
    await Promise.all([
      getCashPosition(ctx),
      getCashForecast(ctx),
      listBatches(ctx),
      getApAging(ctx),
      getArAging(ctx),
      listTaxObligations(ctx, { status: ['PLANNED', 'CALCULATED', 'APPROVED', 'OVERDUE'] }),
      listEvents(ctx, { status: ['CONFIRMED', 'IN_PROGRESS', 'HELD', 'SETTLING'] }),
      getDocumentHealth(ctx),
      listBudgetMatrix(ctx, now.toISOString().slice(0, 7)),
      prisma.advance.count({ where: { tenantId: ctx.tenantId, status: { in: ['OVERDUE'] } } }),
    ]);

  // 1. Cash
  const cashNow = cash.filter((c) => c.account.currency === 'UZS').reduce((sum, c) => sum + c.balanceMinor, 0n);
  const committed7d = forecast.weeks[0] ? forecast.weeks[0].outflowPaymentsMinor + forecast.weeks[0].outflowPlanMinor : 0n;
  const minWeek = forecast.weeks.reduce((min, w) => (w.closingMinor < min ? w.closingMinor : min), forecast.openingMinor);
  const burn = forecast.weeks.length > 0 ? (forecast.openingMinor - (forecast.weeks[forecast.weeks.length - 1]?.closingMinor ?? 0n)) / BigInt(forecast.weeks.length) : 0n;
  const runwayWeeks = burn > 0n ? Number(cashNow / burn) : null;
  // спарклайн из closing по неделям
  const maxClosing = forecast.weeks.reduce((max, w) => (w.closingMinor > max ? w.closingMinor : max), 1n);

  // 2. Today's batch
  const todayBatch = batches.find((b) => b.batchDate.toISOString().slice(0, 10) === today.toISOString().slice(0, 10) && b.type === 'STANDARD');

  // 3. AP
  const apOverdue = apAging.reduce((sum, row) => sum + row.buckets.D1_7 + row.buckets.D8_30 + row.buckets.D31_60 + row.buckets.D60_PLUS, 0n);
  const apDueWeek = apAging.reduce((sum, row) => sum + row.buckets.NOT_DUE, 0n);

  // 4. AR
  const arOverdue = arAging.reduce(
    (sum, row) => sum + row.invoices.filter((inv) => inv.status === 'OVERDUE' || inv.bucket !== 'NOT_DUE').reduce((s, inv) => s + inv.outstandingMinor, 0n),
    0n,
  );
  const arExpected7 = forecast.weeks[0]?.inflowArMinor ?? 0n;
  const arExpected30 = forecast.weeks.slice(0, 4).reduce((sum, w) => sum + w.inflowArMinor, 0n);
  const topDebtors = [...arAging].sort((a, b) => (a.totalMinor > b.totalMinor ? -1 : 1)).slice(0, 3);

  // 5. Taxes: ближайшие 3
  const nextTaxes = taxes.slice(0, 3);

  // 6. Events: ближайшие 5 c P&L
  const nextEvents = events.slice(0, 5);
  const eventPls = await Promise.all(nextEvents.map((event) => getEventPl(ctx, event.id)));

  // 7. Documents
  const docIssues = HEALTH_ZONES.reduce((sum, zone) => sum + health[zone].length, 0);

  // 9. Budget bar по cost center
  const budgetByCc = new Map<string, { plan: bigint; used: bigint }>();
  for (const row of budget) {
    const cc = row.costCenter.code;
    const entry = budgetByCc.get(cc) ?? { plan: 0n, used: 0n };
    entry.plan += row.status.plannedMinor;
    entry.used += row.status.committedMinor + row.status.actualMinor;
    budgetByCc.set(cc, entry);
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />

      {/* 1. Cash */}
      <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('cashNow')} value={fmt(cashNow)} />
        <StatCard label={t('committed7d')} value={fmt(committed7d)} tone={committed7d > cashNow ? 'danger' : 'default'} />
        <StatCard label={t('minWeek13')} value={fmt(minWeek)} tone={minWeek < 0n ? 'danger' : 'success'} />
        <StatCard label={t('runway')} value={runwayWeeks == null ? '∞' : t('weeks', { count: runwayWeeks })} tone={runwayWeeks != null && runwayWeeks < 8 ? 'warning' : 'default'} />
      </div>
      <Link href="/forecast" className="block">
        <Card className="card-lift">
          <div className="flex items-end gap-1" aria-hidden>
            {forecast.weeks.map((week, i) => (
              <div
                key={i}
                className={`w-full rounded-t-sm ${week.closingMinor < 0n ? 'bg-red-400' : 'bg-volt-500/70'}`}
                style={{ height: `${Math.max(6, Number((week.closingMinor > 0n ? week.closingMinor : 0n) * 48n / maxClosing))}px` }}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">{t('sparkline')}</p>
        </Card>
      </Link>

      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 2. Today's batch */}
        <Card title={t('todayBatch')} className="card-lift">
          {todayBatch ? (
            <div className="space-y-1 text-sm">
              <p className="money text-xl font-bold">{fmt(todayBatch.totalMinor)}</p>
              <p className="text-gray-500">
                {t('batchInfo', { count: todayBatch.count })} · <Badge tone="blue">{todayBatch.status}</Badge>
              </p>
              <Link href="/approvals" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                {t('openApprovals')} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t('noBatch')}</p>
          )}
        </Card>

        {/* 3. AP */}
        <Card title={t('ap')} className="card-lift">
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between">
              <span>{t('apDueWeek')}</span>
              <Link href="/ap" className="money font-semibold hover:underline">{fmt(apDueWeek)}</Link>
            </li>
            <li className="flex justify-between">
              <span>{t('apOverdue')}</span>
              <Link href="/ap" className={`money font-semibold hover:underline ${apOverdue > 0n ? 'text-red-600' : ''}`}>{fmt(apOverdue)}</Link>
            </li>
            <li className="flex justify-between">
              <span>{t('advancesNoDocs')}</span>
              <Link href="/documents/health" className={`tnum font-semibold hover:underline ${advancesNoDocs > 0 ? 'text-red-600' : ''}`}>{advancesNoDocs}</Link>
            </li>
          </ul>
        </Card>

        {/* 4. AR */}
        <Card title={t('ar')} className="card-lift">
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between">
              <span>{t('arOverdue')}</span>
              <Link href="/ar" className={`money font-semibold hover:underline ${arOverdue > 0n ? 'text-red-600' : ''}`}>{fmt(arOverdue)}</Link>
            </li>
            <li className="flex justify-between">
              <span>{t('arExpected7')}</span>
              <span className="money text-volt-700">{fmt(arExpected7)}</span>
            </li>
            <li className="flex justify-between">
              <span>{t('arExpected30')}</span>
              <span className="money text-volt-700">{fmt(arExpected30)}</span>
            </li>
          </ul>
          {topDebtors.length > 0 ? (
            <div className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-500">
              {t('topDebtors')}: {topDebtors.map((d) => d.customerName).join(', ')}
            </div>
          ) : null}
        </Card>

        {/* 5. Taxes */}
        <Card title={t('taxes')} className="card-lift">
          <ul className="space-y-1.5 text-sm">
            {nextTaxes.map((tax) => (
              <li key={tax.id} className="flex items-center justify-between gap-2">
                <Link href="/tax" className="hover:underline">
                  {tax.name} · {tax.period}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs">{tax.dueDate.toISOString().slice(5, 10)}</span>
                  <Badge tone={tax.status === 'OVERDUE' ? 'red' : 'gray'}>{tax.status}</Badge>
                </span>
              </li>
            ))}
            {nextTaxes.length === 0 ? <p className="text-gray-500">—</p> : null}
          </ul>
        </Card>

        {/* 6. Events */}
        <Card title={t('events')} className="card-lift lg:col-span-2">
          <ul className="space-y-1.5 text-sm">
            {nextEvents.map((event, i) => {
              const pl = eventPls[i]!;
              return (
                <li key={event.id} className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/events/${event.id}`} className="font-medium hover:underline">
                    {event.eventDate.toISOString().slice(5, 10)} · {event.name}
                  </Link>
                  <span className="flex items-center gap-3 text-xs">
                    <span className="money">{t('rev')} {fmt(pl.revenueInvoicedMinor > 0n ? pl.revenueInvoicedMinor : pl.revenueBudgetMinor)}</span>
                    <span className="money">{t('committed')} {fmt(pl.actualMinor + pl.committedMinor)}</span>
                    <span className={`money font-semibold ${pl.marginCurrentMinor < 0n ? 'text-red-600' : 'text-volt-700'}`}>
                      {t('margin')} {fmt(pl.marginCurrentMinor)}
                    </span>
                  </span>
                </li>
              );
            })}
            {nextEvents.length === 0 ? <p className="text-gray-500">—</p> : null}
          </ul>
        </Card>
      </div>

      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 7. Documents */}
        <Link href="/documents/health">
          <StatCard label={t('docIssues')} value={docIssues} tone={docIssues > 0 ? 'warning' : 'success'} hint={t('docHint')} />
        </Link>
        {/* 8. Controls — полный набор KPI живёт на /controls, здесь только вход (без дубля поверхности) */}
        <Link href="/controls">
          <StatCard label={t('controls')} value="→" tone="default" hint={t('controlsHint')} />
        </Link>
        {/* 9. Budget */}
        <Card title={t('budget')} className="card-lift">
          <ul className="space-y-2">
            {[...budgetByCc.entries()].slice(0, 5).map(([cc, entry]) => (
              <li key={cc}>
                <div className="flex justify-between text-xs">
                  <span className="font-mono font-semibold">{cc}</span>
                  <span className="money text-gray-500">
                    {fmt(entry.used)} / {fmt(entry.plan)}
                  </span>
                </div>
                <Meter value={Number(entry.used / 100n)} max={Number(entry.plan / 100n)} className="mt-1" />
              </li>
            ))}
            {budgetByCc.size === 0 ? <p className="text-sm text-gray-500">—</p> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}
