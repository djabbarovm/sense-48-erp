import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Activity, AlertTriangle, Building2, Coins, FileSignature, Handshake, Sparkles, Users, Wrench } from 'lucide-react';
import { can } from '@finance-os/core';
import { getControlRoom } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Card, PageHeader, StatCard, cn } from '@/components/ui';
import { COLOR_BG, fmtDate, fmtRate } from '@/components/property';
import { LiveRefresh } from '@/components/property/live';

/* Wave 2 — Management Control Room (blueprint §9): сегодня · коммерция · собственники · эксплуатация. */

function Section({ icon, title, children, href, linkLabel }: { icon: React.ReactNode; title: string; children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase">{icon}{title}</h2>
        {href && linkLabel ? <Link href={href} className="text-xs font-medium text-brand-600 hover:underline">{linkLabel}</Link> : null}
      </div>
      {children}
    </section>
  );
}

export default async function ControlRoomPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'property.view')) notFound();
  const t = await getTranslations('controlRoom');
  const tp = await getTranslations('property');
  const td = await getTranslations('deals');
  const cr = await getControlRoom(ctx);
  const k = cr.commercial.kpi;
  const p = cr.commercial.pipeline;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} meta={<span className="flex items-center gap-3 text-sm text-gray-500">{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}<LiveRefresh /></span>} />

      {/* Today */}
      <Section icon={<Activity className="h-3.5 w-3.5" />} title={t('today')}>
        <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          <StatCard label={t('newDeals')} value={cr.today.newDeals} />
          <StatCard label={t('stageMoves')} value={cr.today.stageMoves} />
          <StatCard label={t('viewings')} value={cr.today.viewingsPlanned} />
          <StatCard label={t('attentionDeals')} value={cr.today.attentionDeals} tone={cr.today.attentionDeals ? 'warning' : 'default'} />
          <StatCard label={t('overdueTasks')} value={cr.today.overdueTasks} tone={cr.today.overdueTasks ? 'danger' : 'default'} />
          <StatCard label={t('alerts')} value={cr.today.dataQualityAlerts} tone={cr.today.dataQualityAlerts ? 'danger' : 'default'} />
          <StatCard label={t('critical')} value={cr.today.criticalUnits} tone={cr.today.criticalUnits ? 'danger' : 'success'} />
        </div>
      </Section>

      {/* Commercial */}
      <Section icon={<Building2 className="h-3.5 w-3.5" />} title={t('commercial')} href="/property" linkLabel={t('openBuilding')}>
        <div className="grid gap-3 lg:grid-cols-[2fr_3fr]">
          <Card>
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between"><dt className="text-gray-500">{tp('kpi.occupancy')}</dt><dd className={cn('font-mono font-semibold', k.occupancyPct >= 85 ? 'text-emerald-600' : k.occupancyPct >= 70 ? 'text-amber-600' : 'text-red-600')}>{k.occupancyPct}%</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{tp('kpi.vacant')} / {tp('kpi.renovation')}</dt><dd className="font-mono">{k.vacant} / {k.renovation}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{tp('kpi.gla')}</dt><dd className="font-mono">{(k.availableGlaCm2 / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} {td('sqm')}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{tp('kpi.current')}</dt><dd className="font-mono text-emerald-600">{fmtRate(k.currentIncomeMinor, 'USD')}/{tp('kpi.perMonth')}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">{tp('kpi.potential')}</dt><dd className="font-mono">{fmtRate(k.potentialIncomeMinor, 'USD')}/{tp('kpi.perMonth')}</dd></div>
              {p ? (
                <>
                  <div className="mt-2 border-t border-gray-100 pt-2 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{t('pipeline')}</div>
                  <div className="flex justify-between"><dt className="text-gray-500">{td('kpi.active')}</dt><dd className="font-mono">{p.totals.active}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">{td('kpi.potential')}</dt><dd className="font-mono">{fmtRate(p.totals.potentialMinor, 'USD')}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">{td('kpi.expected')}</dt><dd className="font-mono text-amber-600">{fmtRate(p.totals.expectedMinor, 'USD')}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">{td('kpi.confirmed')}</dt><dd className="font-mono text-emerald-600">{fmtRate(p.totals.confirmedMinor, 'USD')}</dd></div>
                </>
              ) : null}
              <div className="mt-2 border-t border-gray-100 pt-2 flex justify-between"><dt className="text-gray-500">{t('expiring30_90')}</dt><dd className="font-mono"><span className={cr.commercial.expiring30 ? 'text-red-600' : ''}>{cr.commercial.expiring30}</span> / {cr.commercial.expiring90}</dd></div>
            </dl>
          </Card>
          <div className="grid gap-3 sm:grid-cols-3">
            {cr.commercial.byBuilding.map((b) => (
              <Link key={b.id} href={`/property?building=${b.id}`} className="block">
                <Card className="h-full transition-shadow hover:shadow-md">
                  <p className="text-[13px] font-semibold text-gray-900">{b.name}</p>
                  <p className="text-xs text-gray-500">{tp(`kind.${b.kind}`)}</p>
                  <p className={cn('tnum mt-2 font-mono text-2xl font-bold', b.kpi.occupancyPct >= 85 ? 'text-emerald-600' : b.kpi.occupancyPct >= 70 ? 'text-amber-600' : 'text-red-600')}>{b.kpi.occupancyPct}%</p>
                  <p className="text-xs text-gray-500">{tp('kpi.vacant')}: {b.kpi.vacant} · {tp('kpi.renovation')}: {b.kpi.renovation} · {tp('kpi.gla')}: {(b.kpi.availableGlaCm2 / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 })}</p>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Attention deals */}
        {cr.commercial.pipeline ? (
          <Section icon={<Handshake className="h-3.5 w-3.5" />} title={t('attentionList')} href="/deals?attention=1" linkLabel={t('allDeals')}>
            <Card>
              <ul className="divide-y divide-gray-100">
                {cr.lists.attentionDeals.length === 0 ? <li className="py-2 text-sm text-gray-400">{t('nothing')}</li> : null}
                {cr.lists.attentionDeals.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div><Link href={`/deals/${d.id}`} className="font-mono text-xs text-brand-600 hover:underline">{d.number}</Link><span className="ml-2 font-medium text-gray-900">{d.company ?? d.contactName}</span>{d.unitNo ? <span className="ml-2 font-mono text-xs text-gray-500">{d.unitNo}</span> : null}</div>
                    <div className="flex flex-wrap justify-end gap-1">{d.attention.map((a) => (<Badge key={a} tone="red">{td(`attentionKind.${a}`)}</Badge>))}</div>
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        ) : null}
        {/* Expiring leases */}
        {can(ctx, 'lease.view') ? (
          <Section icon={<FileSignature className="h-3.5 w-3.5" />} title={t('expiringList')} href="/leases?view=expiring" linkLabel={t('allLeases')}>
            <Card>
              <ul className="divide-y divide-gray-100">
                {cr.lists.expiringLeases.length === 0 ? <li className="py-2 text-sm text-gray-400">{t('nothing')}</li> : null}
                {cr.lists.expiringLeases.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div><Link href={`/property/units/${l.unitId}`} className="font-mono font-semibold text-ink-900 hover:text-brand-600">{l.unitNo}</Link><span className="ml-2 text-gray-700">{l.occupantName}</span></div>
                    <span className={cn('font-mono text-xs', (l.endsInDays ?? 99) <= 30 ? 'text-red-600' : 'text-gray-500')}>{fmtDate(l.endAt)} · {t('inDays', { n: l.endsInDays ?? 0 })}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        ) : null}
        {/* Owners */}
        <Section icon={<Users className="h-3.5 w-3.5" />} title={t('owners')}>
          <Card>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="font-mono text-xl font-bold text-gray-900">{cr.owners.total}</p><p className="text-[11px] text-gray-500">{t('ownersTotal')}</p></div>
              <div><p className="font-mono text-xl font-bold text-gray-900">{cr.owners.consented}</p><p className="text-[11px] text-gray-500">{t('ownersConsented')}</p></div>
              <div><p className="font-mono text-xl font-bold text-gray-900">{cr.owners.managedUnits}</p><p className="text-[11px] text-gray-500">{t('managedUnits')}</p></div>
            </div>
            <p className="mt-3 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{t('consentedWithoutLease')}</p>
            <ul className="mt-1 divide-y divide-gray-100">
              {cr.owners.consentedWithoutLease.length === 0 ? <li className="py-2 text-sm text-gray-400">{t('nothing')}</li> : null}
              {cr.owners.consentedWithoutLease.slice(0, 6).map((o) => (<li key={o.id} className="flex justify-between gap-2 py-1.5 text-sm"><span className="text-gray-900">{o.displayName}</span><span className="font-mono text-xs text-gray-500">{o.units.join(', ')}</span></li>))}
            </ul>
          </Card>
        </Section>
        {cr.finance ? (
          <Section icon={<Coins className="h-3.5 w-3.5" />} title={t('finance')} href="/rent" linkLabel={t('allRent')}>
            <Card>
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
                <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-900">{fmtRate(cr.finance.outstandingMinor, cr.finance.currency)}</p><p className="text-[11px] text-gray-500">{t('outstanding')}</p></div>
                <div><p className={cn('font-mono text-base font-bold whitespace-nowrap', cr.finance.overdueMinor > 0n ? 'text-red-600' : 'text-gray-400')}>{fmtRate(cr.finance.overdueMinor, cr.finance.currency)}</p><p className="text-[11px] text-gray-500">{t('overdueAmount')}</p></div>
                <div><p className="font-mono text-xl font-bold text-gray-900">{cr.finance.debtorUnits}</p><p className="text-[11px] text-gray-500">{t('debtors')}</p></div>
                <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-900">{fmtRate(cr.finance.monthChargedMinor, cr.finance.currency)}</p><p className="text-[11px] text-gray-500">{t('monthCharged')}</p></div>
                <div><p className="font-mono text-base font-bold whitespace-nowrap text-emerald-600">{fmtRate(cr.finance.monthReceivedMinor, cr.finance.currency)}</p><p className="text-[11px] text-gray-500">{t('monthReceived')}</p></div>
                <div><p className={cn('font-mono text-xl font-bold', cr.finance.collectionPct != null && cr.finance.collectionPct < 70 ? 'text-red-600' : 'text-gray-900')}>{cr.finance.collectionPct == null ? '—' : `${cr.finance.collectionPct}%`}</p><p className="text-[11px] text-gray-500">{t('collection')}</p></div>
              </div>
              <p className="mt-3 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{t('topDebtors')}</p>
              <ul className="mt-1 divide-y divide-gray-100">
                {cr.finance.topDebtors.length === 0 ? <li className="py-2 text-sm text-gray-400">{t('nothing')}</li> : null}
                {cr.finance.topDebtors.slice(0, 6).map((u) => (
                  <li key={u.unitId} className="flex items-center justify-between gap-2 py-1.5 text-sm"><span><Link href={`/property/units/${u.unitId}`} className="font-mono font-semibold text-ink-900 hover:text-brand-600">{u.unitNo}</Link><span className="ml-2 text-xs text-gray-500">{u.occupantName}</span></span><span className={cn('font-mono text-xs', u.daysOverdue > 0 ? 'text-red-600' : 'text-gray-600')}>{fmtRate(u.outstandingMinor, cr.finance!.currency)}{u.daysOverdue ? ` · ${u.daysOverdue} дн.`.replace(' дн.', '') + ' d' : ''}</span></li>
                ))}
              </ul>
            </Card>
          </Section>
        ) : null}
        {cr.services ? (
          <Section icon={<Sparkles className="h-3.5 w-3.5" />} title={t('services')} href="/services" linkLabel={t('allServices')}>
            <Card>
              <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
                <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-900">{fmtRate(cr.services.gmvMinor, cr.services.currency)}</p><p className="text-[11px] text-gray-500">{t('servicesGmv')}</p></div>
                <div><p className="font-mono text-base font-bold whitespace-nowrap text-emerald-600">{fmtRate(cr.services.platformRevenueMinor, cr.services.currency)}</p><p className="text-[11px] text-gray-500">{t('servicesRevenue')}</p></div>
                <div><p className="font-mono text-xl font-bold text-gray-900">{cr.services.done}</p><p className="text-[11px] text-gray-500">{t('servicesDone')}</p></div>
                <div><p className="font-mono text-xl font-bold text-amber-600">{cr.services.open}</p><p className="text-[11px] text-gray-500">{t('servicesOpen')}</p></div>
                <div><p className={cn('font-mono text-xl font-bold', cr.services.overdue ? 'text-red-600' : 'text-gray-400')}>{cr.services.overdue}</p><p className="text-[11px] text-gray-500">{t('servicesOverdue')}</p></div>
                <div><p className={cn('font-mono text-xl font-bold', cr.services.slaPct != null && cr.services.slaPct < 80 ? 'text-red-600' : 'text-gray-900')}>{cr.services.slaPct == null ? '—' : `${cr.services.slaPct}%`}</p><p className="text-[11px] text-gray-500">{t('servicesSla')}{cr.services.avgRating != null ? ` · ★ ${cr.services.avgRating}` : ''}</p></div>
              </div>
              {cr.services.byProvider.filter((p) => p.providerKind === 'PARTNER').length ? (
                <>
                  <p className="mt-3 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{t('partnerSla')}</p>
                  <ul className="mt-1 divide-y divide-gray-100">
                    {cr.services.byProvider.filter((p) => p.providerKind === 'PARTNER').map((p) => (
                      <li key={p.partnerName ?? ''} className="flex items-center justify-between gap-2 py-1.5 text-sm"><span className="font-medium text-gray-900">{p.partnerName}</span><span className={cn('font-mono text-xs', p.slaPct != null && p.slaPct < 80 ? 'text-red-600' : 'text-gray-600')}>{p.orders} · {fmtRate(p.gmvMinor, cr.services!.currency)} · SLA {p.slaPct == null ? '—' : `${p.slaPct}%`}{p.avgRating != null ? ` · ★ ${p.avgRating}` : ''}</span></li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Card>
          </Section>
        ) : null}
        {/* Operations + alerts */}
        <Section icon={<Wrench className="h-3.5 w-3.5" />} title={t('operations')} href="/property?alerts=1" linkLabel={t('showAlerts')}>
          <Card>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div><p className="font-mono text-xl font-bold text-gray-500">{cr.operations.renovation}</p><p className="text-[11px] text-gray-500">{tp('kpi.renovation')}</p></div>
              <div><p className="font-mono text-xl font-bold text-amber-600">{cr.operations.issue}</p><p className="text-[11px] text-gray-500">{tp('operational.ISSUE')}</p></div>
              <div><p className="font-mono text-xl font-bold text-red-600">{cr.operations.critical}</p><p className="text-[11px] text-gray-500">{tp('operational.CRITICAL')}</p></div>
              <div><p className="font-mono text-xl font-bold text-gray-900">{cr.operations.blocked}</p><p className="text-[11px] text-gray-500">{tp('operational.BLOCKED')}</p></div>
            </div>
            <p className="mt-3 flex items-center gap-1 text-[11px] font-semibold tracking-wider text-gray-400 uppercase"><AlertTriangle className="h-3 w-3" />{t('alertUnits')}</p>
            <ul className="mt-1 divide-y divide-gray-100">
              {cr.lists.alertUnits.length === 0 ? <li className="py-2 text-sm text-gray-400">{t('nothing')}</li> : null}
              {cr.lists.alertUnits.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="inline-flex items-center gap-2"><span className={cn('h-2.5 w-2.5 rounded-[2px]', COLOR_BG[u.view.color])} aria-hidden /><Link href={`/property/units/${u.id}`} className="font-mono font-semibold text-ink-900 hover:text-brand-600">{u.unitNo}</Link></span>
                  <span className="text-right text-xs text-amber-800">{u.view.alerts.map((a) => tp(`alert.${a}`)).join('; ')}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{t('idleUnits')}</p>
            <ul className="mt-1 divide-y divide-gray-100">
              {cr.lists.idleUnits.length === 0 ? <li className="py-2 text-sm text-gray-400">{t('nothing')}</li> : null}
              {cr.lists.idleUnits.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <Link href={`/property/units/${u.id}`} className="font-mono font-semibold text-ink-900 hover:text-brand-600">{u.unitNo}</Link>
                  <span className="font-mono text-xs text-red-600">{tp('vacantDaysShort', { n: u.view.vacantDays ?? 0 })}{u.askingRateMinor ? ` · ${fmtRate(u.askingRateMinor, u.askingCurrency)}` : ''}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      </div>
    </div>
  );
}
