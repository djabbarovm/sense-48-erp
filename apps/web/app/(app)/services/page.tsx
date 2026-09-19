import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, BarChart3, Plus, Repeat, Sparkles, Star } from 'lucide-react';
import { SERVICE_CATEGORIES, SERVICE_CHANNELS, SERVICE_CUSTOMER_KINDS, SERVICE_INVOLVEMENT, SERVICE_PROVIDER_KINDS, SERVICE_TERMS, can } from '@finance-os/core';
import { getServicesAnalytics, getServicesSummary, listAssignees, listBuildings, listCatalog, listServiceOrders, listServicePackages, listUnits } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Table, Td, Th, cn } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';
import { cancelPackageAction, createCatalogItemAction, createPackageAction, createServiceOrderAction, importStatementAction, toggleCatalogItemAction } from './actions';
import { PROVIDER_TONE, STATUS_TONE } from './tones';

/* Wave 5 — Services marketplace (blueprint §12): каталог, заказы, GMV/монетизация, SLA партнёров. */

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ view?: string; error?: string; unit?: string; days?: string; imported?: string; skipped?: string; fee?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'service.view')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('services');
  const view = sp.view ?? 'open';
  const filter = view === 'overdue' ? { overdueOnly: true } : view === 'mine' ? { mine: true } : view === 'done' ? { status: ['DONE', 'VERIFIED', 'CANCELLED'] as const } : { status: ['NEW', 'ACCEPTED', 'IN_PROGRESS'] as const };
  const [rows, catalog, assignees, buildings, units, summary] = await Promise.all([
    view === 'catalog' || view === 'analytics' || view === 'packages' ? Promise.resolve([]) : listServiceOrders(ctx, { ...('status' in filter ? { status: [...filter.status] } : {}), ...('overdueOnly' in filter ? { overdueOnly: true } : {}), ...('mine' in filter ? { mine: true } : {}) }),
    listCatalog(ctx, { includeInactive: can(ctx, 'service.catalog') }),
    can(ctx, 'service.manage') ? listAssignees(ctx) : Promise.resolve([]),
    listBuildings(ctx),
    can(ctx, 'service.order') ? listUnits(ctx) : Promise.resolve([]),
    getServicesSummary(ctx, { days: 30 }),
  ]);
  const overdueCount = rows.filter((r) => r.overdue).length;
  const tabs = ['open', 'overdue', 'mine', 'done', 'catalog', 'packages', 'analytics'] as const;
  const days = [30, 90, 180, 365].includes(Number(sp.days)) ? Number(sp.days) : 90;
  const analytics = view === 'analytics' ? await getServicesAnalytics(ctx, days) : null;
  const packages = view === 'packages' ? await listServicePackages(ctx) : [];
  const active = catalog.filter((c) => c.active);
  const pct = (v: number | null) => (v == null ? t('summary.noData') : `${v}%`);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        meta={<span className="flex items-center gap-2"><Badge tone="gray">{t('count', { n: rows.length })}</Badge>{overdueCount ? <Badge tone="red" dot>{t('overdueCount', { n: overdueCount })}</Badge> : null}</span>}
        actions={<div className="flex flex-wrap gap-1.5">{tabs.map((v) => (<Link key={v} href={`/services?view=${v}`} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', view === v ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>{t(`tab.${v}`)}</Link>))}</div>}
      />
      {sp.error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : t('error.GENERIC')}</div> : null}

      {/* Сводка: GMV, монетизация, SLA (blueprint §9 Services) */}
      <Card>
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Sparkles className="h-4 w-4 text-brand-500" />{t('summary.title')}</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4 lg:grid-cols-8">
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-900">{fmtRate(summary.gmvMinor, summary.currency)}</p><p className="text-[11px] text-gray-500">{t('summary.gmv')}</p></div>
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-emerald-600">{fmtRate(summary.servicesRevenueMinor, summary.currency)}</p><p className="text-[11px] text-gray-500">{t('summary.servicesRevenue')}</p></div>
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-brand-600">{fmtRate(summary.operationsRevenueMinor, summary.currency)}</p><p className="text-[11px] text-gray-500">{t('summary.operationsRevenue')}</p></div>
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-500">{fmtRate(summary.partnerPayoutMinor, summary.currency)}</p><p className="text-[11px] text-gray-500">{t('summary.partnerPayout')}</p></div>
          <div><p className="font-mono text-lg font-bold text-gray-900">{summary.done}</p><p className="text-[11px] text-gray-500">{t('summary.done')}</p></div>
          <div><p className={cn('font-mono text-lg font-bold', summary.overdue ? 'text-red-600' : 'text-amber-600')}>{summary.open}</p><p className="text-[11px] text-gray-500">{t('summary.open')}</p></div>
          <div><p className={cn('font-mono text-lg font-bold', summary.slaPct != null && summary.slaPct < 80 ? 'text-red-600' : 'text-gray-900')}>{pct(summary.slaPct)}</p><p className="text-[11px] text-gray-500">{t('summary.sla')}</p></div>
          <div><p className="font-mono text-lg font-bold text-gray-900">{summary.avgRating ?? '—'}</p><p className="text-[11px] text-gray-500">{t('summary.rating')}</p></div>
        </div>
        {summary.byProvider.length ? (
          <div className="mt-3 grid gap-2 border-t border-gray-100 pt-3 text-xs sm:grid-cols-2">
            <div>
              <p className="font-semibold tracking-wider text-gray-400 uppercase">{t('summary.byProvider')}</p>
              <ul className="mt-1 divide-y divide-gray-100">{summary.byProvider.map((p) => (<li key={`${p.providerKind}:${p.partnerName ?? ''}`} className="flex items-center justify-between gap-2 py-1"><span><Badge tone={PROVIDER_TONE[p.providerKind]}>{t(`providerKind.${p.providerKind}`)}</Badge>{p.partnerName ? <span className="ml-1 font-medium text-gray-800">{p.partnerName}</span> : null}<span className="ml-2 text-gray-500">{t('summary.orders', { n: p.orders })}</span></span><span className="font-mono text-gray-700">{fmtRate(p.gmvMinor, summary.currency)} · SLA {pct(p.slaPct)}{p.avgRating != null ? ` · ★ ${p.avgRating}` : ''}</span></li>))}</ul>
            </div>
            <div>
              <p className="font-semibold tracking-wider text-gray-400 uppercase">{t('summary.byCategory')}</p>
              <ul className="mt-1 divide-y divide-gray-100">{summary.byCategory.map((c) => (<li key={c.category} className="flex items-center justify-between gap-2 py-1"><span>{t(`category.${c.category}`)}<span className="ml-2 text-gray-500">{t('summary.orders', { n: c.orders })}</span></span><span className="font-mono text-gray-700">{fmtRate(c.gmvMinor, summary.currency)}</span></li>))}</ul>
            </div>
          </div>
        ) : null}
      </Card>

      {view === 'packages' ? (
        <>
          {can(ctx, 'service.order') && active.length ? (
            <Card>
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Repeat className="h-4 w-4" />{t('package.newTitle')}</h3>
              <form action={createPackageAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
                <div className="lg:col-span-2"><Label htmlFor="p-item">{t('package.service')}</Label><Select id="p-item" name="catalogItemId" required>{active.map((c) => (<option key={c.id} value={c.id}>{c.name}{c.partnerName ? ` · ${c.partnerName}` : ''}</option>))}</Select></div>
                <div><Label htmlFor="p-unit">{t('package.unit')}</Label><Select id="p-unit" name="unitId" required>{units.map((u) => (<option key={u.id} value={u.id}>{u.unitNo}</option>))}</Select></div>
                <div><Label htmlFor="p-cust">{t('package.customer')}</Label><Input id="p-cust" name="customerName" /></div>
                <div><Label htmlFor="p-ck">{t('fields.customerKind')}</Label><Select id="p-ck" name="customerKind" defaultValue="RESIDENT">{SERVICE_CUSTOMER_KINDS.map((x) => (<option key={x} value={x}>{t(`customerKind.${x}`)}</option>))}</Select></div>
                <div><Label htmlFor="p-runs">{t('package.runsPerMonth')}</Label><Input id="p-runs" name="runsPerMonth" type="number" min="1" max="31" defaultValue="8" /></div>
                <div><Label htmlFor="p-monthly">{t('package.monthly')}</Label><Input id="p-monthly" name="monthly" type="number" min="0.01" step="0.01" required /></div>
                <div><Label htmlFor="p-start">{t('package.startAt')}</Label><Input id="p-start" name="startAt" type="date" /></div>
                <div className="self-end"><Button type="submit">{t('package.create')}</Button></div>
              </form>
              <p className="mt-2 text-[11px] text-gray-400">{t('package.hint')}</p>
            </Card>
          ) : null}
          {packages.length === 0 ? <EmptyState icon={<Repeat />} text={t('package.empty')} /> : (
            <Table>
              <thead><tr><Th>{t('package.service')}</Th><Th>{t('package.unit')}</Th><Th>{t('package.customer')}</Th><Th>{t('package.runsPerMonth')}</Th><Th className="text-right">{t('package.monthly')}</Th><Th>{t('package.next')}</Th><Th>{t('fields.status')}</Th>{can(ctx, 'service.manage') ? <Th /> : null}</tr></thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id}>
                    <Td><span className="font-medium text-gray-900">{p.serviceName}</span><span className="ml-2 text-xs text-gray-500">{p.partnerName ?? t(`providerKind.${p.providerKind}`)}</span></Td>
                    <Td className="font-mono font-semibold">{p.unitNo}</Td>
                    <Td className="text-xs">{p.customerName ?? '—'} · {t(`customerKind.${p.customerKind}`)}</Td>
                    <Td className="font-mono text-xs">{p.runsPerMonth}<span className="ml-2 text-gray-400">{t('package.orders', { n: p.ordersCount })}</span></Td>
                    <Td className="text-right font-mono">{fmtRate(p.monthlyPriceMinor, p.currency)}</Td>
                    <Td className="font-mono text-xs text-gray-600">{fmtDate(p.nextRunAt)}</Td>
                    <Td><Badge tone={p.status === 'ACTIVE' ? 'green' : p.status === 'PAUSED' ? 'yellow' : 'gray'} dot>{t(`package.status.${p.status}`)}</Badge>{p.cancelReason ? <p className="text-[10px] text-gray-400">{p.cancelReason}</p> : null}</Td>
                    {can(ctx, 'service.manage') ? <Td>{p.status === 'ACTIVE' ? <form action={cancelPackageAction} className="flex items-center gap-1"><input type="hidden" name="id" value={p.id} /><Input name="reason" placeholder={t('package.reason')} required className="h-8 w-32 py-0 text-xs" /><Button type="submit" size="sm" variant="outline">{t('package.cancel')}</Button></form> : null}</Td> : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      ) : null}

      {view === 'analytics' && analytics ? (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><BarChart3 className="h-4 w-4 text-brand-500" />{t('analytics.title')}</h3>
              <div className="flex gap-1">{[30, 90, 180, 365].map((n) => (<Link key={n} href={`/services?view=analytics&days=${n}`} className={cn('rounded-md px-2 py-1 text-xs font-medium', days === n ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700')}>{n}</Link>))}</div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-3 lg:grid-cols-7">
              <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-900">{fmtRate(analytics.totals.gmvMinor, analytics.currency)}</p><p className="text-[11px] text-gray-500">{t('analytics.gmv')}</p></div>
              <div><p className="font-mono text-base font-bold whitespace-nowrap text-emerald-600">{fmtRate(analytics.totals.servicesRevenueMinor, analytics.currency)}</p><p className="text-[11px] text-gray-500">{t('analytics.revenue')}</p></div>
              <div><p className="font-mono text-base font-bold whitespace-nowrap text-emerald-600">{fmtRate(analytics.totals.referralMinor, analytics.currency)}</p><p className="text-[11px] text-gray-500">{t('analytics.referral')}</p></div>
              <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-500">{fmtRate(analytics.totals.executorRevenueMinor, analytics.currency)}</p><p className="text-[11px] text-gray-500">{t('analytics.executor')}</p></div>
              <div><p className="font-mono text-base font-bold whitespace-nowrap text-red-600">{fmtRate(analytics.totals.costToServeMinor, analytics.currency)}</p><p className="text-[11px] text-gray-500">{t('analytics.cost')}</p></div>
              <div><p className={cn('font-mono text-base font-bold whitespace-nowrap', analytics.totals.contributionMinor >= 0n ? 'text-emerald-700' : 'text-red-600')}>{fmtRate(analytics.totals.contributionMinor, analytics.currency)}</p><p className="text-[11px] text-gray-500">{t('analytics.contribution')}</p></div>
              <div><p className={cn('font-mono text-base font-bold', analytics.totals.complaints ? 'text-amber-600' : 'text-gray-400')}>{analytics.totals.complaints}</p><p className="text-[11px] text-gray-500">{t('analytics.complaints')}</p></div>
            </div>
            <p className="mt-2 text-[11px] text-gray-400">{t('analytics.gmvHint')} {t('analytics.hourCost', { v: fmtRate(analytics.hourCostMinor, analytics.currency) })}</p>
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <h3 className="font-display text-sm font-semibold">{t('analytics.directions')}</h3>
              <Table>
                <thead><tr><Th>{t('analytics.direction')}</Th><Th className="text-right">{t('analytics.orders')}</Th><Th className="text-right">{t('analytics.gmv')}</Th><Th className="text-right">{t('analytics.revenue')}</Th><Th className="text-right">{t('analytics.cost')}</Th><Th className="text-right">{t('analytics.contribution')}</Th><Th>{t('analytics.sla')} · {t('analytics.rating')}</Th></tr></thead>
                <tbody>
                  {analytics.directions.map((l) => (
                    <tr key={l.key}>
                      <Td><span className="font-medium text-gray-900">{t(`category.${l.category as never}`)}</span><span className="ml-2 text-xs text-gray-500">{l.partnerName ?? t(`providerKind.${l.providerKind as never}`)}</span><p className="text-[10px] text-gray-400">{t(`terms.${l.terms as never}`)} · {t(`involvement.${l.involvement as never}`)} · {l.avgHandlingMinutes} {t('analytics.minutes')}{l.complaints ? ` · ${t('analytics.complaints')} ${l.complaints}` : ''}</p></Td>
                      <Td className="text-right font-mono">{l.orders}</Td>
                      <Td className="text-right font-mono text-xs">{fmtRate(l.gmvMinor, analytics.currency)}</Td>
                      <Td className="text-right font-mono text-xs text-emerald-600">{fmtRate(l.servicesRevenueMinor, analytics.currency)}</Td>
                      <Td className="text-right font-mono text-xs text-red-600">{fmtRate(l.costToServeMinor, analytics.currency)}</Td>
                      <Td className={cn('text-right font-mono text-xs font-semibold', l.contributionMinor >= 0n ? 'text-emerald-700' : 'text-red-600')}>{fmtRate(l.contributionMinor, analytics.currency)}</Td>
                      <Td className="font-mono text-xs text-gray-600">{l.slaPct == null ? '—' : `${l.slaPct}%`} · {l.avgRating ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <div className="space-y-4">
              <Card>
                <h3 className="font-display text-sm font-semibold">{t('analytics.demand')}</h3>
                <dl className="mt-2 space-y-1 text-[13px]">
                  <div className="flex justify-between"><dt className="text-gray-500">{t('analytics.customerBase')}</dt><dd className="font-mono">{analytics.demand.customerBase}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">{t('analytics.buyers')}</dt><dd className="font-mono">{analytics.demand.buyers}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">{t('analytics.penetration')}</dt><dd className="font-mono">{analytics.demand.penetrationPct == null ? '—' : `${analytics.demand.penetrationPct}%`}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">{t('analytics.attach')}</dt><dd className="font-mono">{analytics.demand.attachRate ?? '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">{t('analytics.repeat')}</dt><dd className="font-mono">{analytics.demand.repeatBuyers}{analytics.demand.repeatPct != null ? ` · ${analytics.demand.repeatPct}%` : ''}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">{t('analytics.mrr')}</dt><dd className="font-mono">{fmtRate(analytics.packages.mrrMinor, analytics.currency)} · {analytics.packages.active}</dd></div>
                </dl>
                <p className="mt-3 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{t('analytics.byChannel')}</p>
                <ul className="mt-1 text-xs text-gray-700">{analytics.byChannel.map((c) => (<li key={c.channel} className="flex justify-between py-0.5"><span>{t(`channel.${c.channel}`)}</span><span className="font-mono">{c.orders}</span></li>))}</ul>
                <p className="mt-3 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{t('analytics.byCustomer')}</p>
                <ul className="mt-1 text-xs text-gray-700">{analytics.byCustomerKind.filter((c) => c.orders).map((c) => (<li key={c.kind} className="flex justify-between py-0.5"><span>{t(`customerKind.${c.kind}`)}</span><span className="font-mono">{c.orders} · {fmtRate(c.gmvMinor, analytics.currency)}</span></li>))}</ul>
              </Card>
              <Card>
                <h3 className="font-display text-sm font-semibold">{t('analytics.referralTitle')}</h3>
                {sp.imported ? <p className="mt-1 rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800">{t('statement.imported', { n: sp.imported, s: sp.skipped ?? '0', fee: fmtRate(BigInt(sp.fee ?? '0'), analytics.currency) })}</p> : null}
                <ul className="mt-2 divide-y divide-gray-100 text-xs">
                  {analytics.referral.length === 0 ? <li className="py-1 text-gray-400">{t('analytics.noReferral')}</li> : null}
                  {analytics.referral.map((r) => (<li key={`${r.partnerName}-${r.period}`} className="flex items-center justify-between gap-2 py-1"><span><span className="font-medium text-gray-900">{r.partnerName}</span> <span className="font-mono text-gray-500">{r.period}</span> <span className="text-gray-400">{t('analytics.lines', { n: r.lines })}</span></span><span className="font-mono text-emerald-600">{fmtRate(r.feeMinor, analytics.currency)}</span></li>))}
                </ul>
                {can(ctx, 'service.catalog') ? (
                  <form action={importStatementAction} className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                    <h4 className="text-[13px] font-semibold text-gray-800">{t('statement.title')}</h4>
                    <p className="text-[11px] text-gray-400">{t('statement.hint')}</p>
                    <div className="grid grid-cols-2 gap-2"><div><Label htmlFor="st-p">{t('statement.partner')}</Label><Input id="st-p" name="partnerName" required defaultValue="CityNet" /></div><div><Label htmlFor="st-per">{t('statement.period')}</Label><Input id="st-per" name="period" type="month" required /></div></div>
                    <div><Label htmlFor="st-csv">{t('statement.csv')}</Label><textarea id="st-csv" name="csv" required rows={4} className="w-full rounded-md border border-gray-200 px-3 py-2 font-mono text-xs" placeholder="1004;120000;15" /></div>
                    <Button type="submit" size="sm" variant="outline">{t('statement.submit')}</Button>
                  </form>
                ) : null}
              </Card>
            </div>
          </div>
        </>
      ) : null}

      {view === 'catalog' ? (
        <>
          {can(ctx, 'service.catalog') ? (
            <Card>
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Plus className="h-4 w-4" />{t('catalog.newTitle')}</h3>
              <form action={createCatalogItemAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div><Label htmlFor="c-code">{t('catalog.code')} *</Label><Input id="c-code" name="code" required placeholder="CLEAN-STD" /></div>
                <div className="lg:col-span-2"><Label htmlFor="c-name">{t('catalog.name')} *</Label><Input id="c-name" name="name" required /></div>
                <div><Label htmlFor="c-cat">{t('fields.service')}</Label><Select id="c-cat" name="category" defaultValue="CLEANING">{SERVICE_CATEGORIES.map((c) => (<option key={c} value={c}>{t(`category.${c}`)}</option>))}</Select></div>
                <div><Label htmlFor="c-kind">{t('fields.provider')}</Label><Select id="c-kind" name="providerKind" defaultValue="OWN_OPS">{SERVICE_PROVIDER_KINDS.map((k) => (<option key={k} value={k}>{t(`providerKind.${k}`)}</option>))}</Select></div>
                <div><Label htmlFor="c-partner">{t('catalog.partner')}</Label><Input id="c-partner" name="partnerName" /></div>
                <div><Label htmlFor="c-price">{t('catalog.price')} *</Label><Input id="c-price" name="price" type="number" min="0" step="0.01" required /></div>
                <div><Label htmlFor="c-cur">{t('catalog.currency')}</Label><Select id="c-cur" name="currency" defaultValue="UZS"><option value="UZS">UZS</option><option value="USD">USD</option></Select></div>
                <div><Label htmlFor="c-comm">{t('catalog.commissionPct')}</Label><Input id="c-comm" name="commissionPct" type="number" min="0" max="100" step="0.5" defaultValue="0" /></div>
                <div><Label htmlFor="c-sla">{t('catalog.sla')}</Label><Input id="c-sla" name="slaHours" type="number" min="1" defaultValue="48" /></div>
                <div><Label htmlFor="c-terms">{t('catalog.terms')}</Label><Select id="c-terms" name="terms" defaultValue="COMMISSION_PER_ORDER">{SERVICE_TERMS.map((x) => (<option key={x} value={x}>{t(`terms.${x}`)}</option>))}</Select></div>
                <div><Label htmlFor="c-inv">{t('catalog.involvement')}</Label><Select id="c-inv" name="involvement" defaultValue="MANAGED">{SERVICE_INVOLVEMENT.map((x) => (<option key={x} value={x}>{t(`involvement.${x}`)}</option>))}</Select></div>
                <div><Label htmlFor="c-disc">{t('catalog.discountPct')}</Label><Input id="c-disc" name="discountPct" type="number" min="0" max="100" step="0.5" defaultValue="0" /></div>
                <div><Label htmlFor="c-oof">{t('catalog.ownOpsFeePct')}</Label><Input id="c-oof" name="ownOpsFeePct" type="number" min="0" max="100" step="0.5" /></div>
                <label className="flex items-center gap-2 self-end text-xs text-gray-700"><input type="checkbox" name="forMall" className="h-4 w-4" />{t('catalog.forMall')}</label>
                <div className="lg:col-span-4"><Label htmlFor="c-desc">{t('catalog.description')}</Label><Input id="c-desc" name="description" /></div>
                <div className="self-end"><Button type="submit">{t('catalog.create')}</Button></div>
              </form>
              <p className="mt-2 text-[11px] text-gray-400">{t('catalog.hint')}</p>
            </Card>
          ) : null}
          {catalog.length === 0 ? <EmptyState icon={<Sparkles />} text={t('catalog.empty')} /> : (
            <Table>
              <thead><tr><Th>{t('catalog.code')}</Th><Th>{t('catalog.name')}</Th><Th>{t('fields.provider')}</Th><Th className="text-right">{t('catalog.price')}</Th><Th className="text-right">{t('catalog.commissionPct')}</Th><Th>{t('catalog.sla')}</Th>{can(ctx, 'service.catalog') ? <Th>{t('catalog.active')}</Th> : null}</tr></thead>
              <tbody>
                {catalog.map((c) => (
                  <tr key={c.id} className={cn(!c.active && 'opacity-50')}>
                    <Td className="font-mono text-xs font-semibold">{c.code}</Td>
                    <Td><span className="font-medium text-gray-900">{c.name}</span><span className="ml-2 text-xs text-gray-500">{t(`category.${c.category}`)}</span>{c.description ? <p className="text-xs text-gray-500">{c.description}</p> : null}</Td>
                    <Td><Badge tone={PROVIDER_TONE[c.providerKind]}>{t(`providerKind.${c.providerKind}`)}</Badge>{c.partnerName ? <span className="ml-1 text-xs text-gray-700">{c.partnerName}</span> : null}<p className="text-[10px] text-gray-400">{t(`terms.${c.terms}`)} · {t(`involvement.${c.involvement}`)}{c.clientDiscountBp ? ` · −${c.clientDiscountBp / 100}%` : ''}{c.forMall ? ' · Mall' : ''}</p></Td>
                    <Td className="text-right font-mono">{fmtRate(c.priceMinor, c.currency)}</Td>
                    <Td className="text-right font-mono text-xs">{c.providerKind === 'PARTNER' ? `${c.commissionBp / 100}%` : '—'}</Td>
                    <Td className="font-mono text-xs">{c.slaHours}</Td>
                    {can(ctx, 'service.catalog') ? <Td><form action={toggleCatalogItemAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.active ? 'false' : 'true'} /><Button type="submit" size="sm" variant="outline">{c.active ? t('catalog.inactive') : t('catalog.active')}</Button></form></Td> : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      ) : view === 'packages' || view === 'analytics' ? null : (
        <>
          {can(ctx, 'service.order') && active.length ? (
            <Card>
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Plus className="h-4 w-4" />{t('newTitle')}</h3>
              <form action={createServiceOrderAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <input type="hidden" name="back" value="/services" />
                <div className="lg:col-span-2"><Label htmlFor="s-item">{t('fields.service')} *</Label><Select id="s-item" name="catalogItemId" required>{active.map((c) => (<option key={c.id} value={c.id}>{c.name} · {fmtRate(c.priceMinor, c.currency)}{c.partnerName ? ` · ${c.partnerName}` : ''}</option>))}</Select></div>
                <div><Label htmlFor="s-unit">{t('fields.unit')}</Label><Select id="s-unit" name="unitId" defaultValue={sp.unit ?? ''}><option value="">{t('fields.noUnit')}</option>{units.map((u) => (<option key={u.id} value={u.id}>{u.unitNo}</option>))}</Select></div>
                <div><Label htmlFor="s-building">{t('fields.building')}</Label><Select id="s-building" name="buildingId" defaultValue=""><option value="">—</option>{buildings.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}</Select></div>
                <div><Label htmlFor="s-qty">{t('fields.quantity')}</Label><Input id="s-qty" name="quantity" type="number" min="1" max="100" defaultValue="1" /></div>
                <div><Label htmlFor="s-when">{t('fields.scheduledAt')}</Label><Input id="s-when" name="scheduledAt" type="datetime-local" /></div>
                <div><Label htmlFor="s-channel">{t('fields.channel')}</Label><Select id="s-channel" name="channel" defaultValue="STAFF">{SERVICE_CHANNELS.map((x) => (<option key={x} value={x}>{t(`channel.${x}`)}</option>))}</Select></div>
                <div><Label htmlFor="s-ck">{t('fields.customerKind')}</Label><Select id="s-ck" name="customerKind" defaultValue=""><option value="">—</option>{SERVICE_CUSTOMER_KINDS.map((x) => (<option key={x} value={x}>{t(`customerKind.${x}`)}</option>))}</Select></div>
                <div className="lg:col-span-2"><Label htmlFor="s-customer">{t('fields.customer')}</Label><Input id="s-customer" name="customerName" /></div>
                <div className="lg:col-span-2"><Label htmlFor="s-notes">{t('fields.notes')}</Label><Input id="s-notes" name="notes" /></div>
                {assignees.length ? <div><Label htmlFor="s-assignee">{t('fields.assignee')}</Label><Select id="s-assignee" name="assigneeId" defaultValue=""><option value="">{t('fields.unassigned')}</option>{assignees.map((a) => (<option key={a.id} value={a.id}>{a.fullName}</option>))}</Select></div> : null}
                <div className="self-end"><Button type="submit">{t('create')}</Button></div>
              </form>
            </Card>
          ) : null}

          {rows.length === 0 ? <EmptyState icon={<Sparkles />} text={t('empty')} /> : (
            <Table>
              <thead><tr><Th>{t('fields.number')}</Th><Th>{t('fields.service')}</Th><Th>{t('fields.unit')}</Th><Th>{t('fields.provider')}</Th><Th className="text-right">{t('fields.price')}</Th><Th>{t('fields.status')}</Th><Th>{t('fields.due')}</Th><Th>{t('fields.assignee')}</Th></tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className={cn('group', o.overdue ? 'bg-red-50/40' : '')}>
                    <Td><Link href={`/services/${o.id}`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">{o.number}</Link></Td>
                    <Td><span className="font-medium text-gray-900">{o.serviceName}</span>{o.quantity > 1 ? <span className="ml-1 text-xs text-gray-500">× {o.quantity}</span> : null}<span className="ml-2 text-xs text-gray-500">{t(`category.${o.category}`)}</span>{o.rating != null ? <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-amber-600"><Star className="h-3 w-3" />{o.rating}</span> : null}</Td>
                    <Td>{o.unitId ? <Link href={`/property/units/${o.unitId}`} className="font-mono font-semibold text-ink-900 hover:text-brand-600">{o.unitNo}</Link> : <span className="text-xs text-gray-500">{o.buildingName ?? '—'}</span>}</Td>
                    <Td><Badge tone={PROVIDER_TONE[o.providerKind]}>{o.partnerName ?? t(`providerKind.${o.providerKind}`)}</Badge></Td>
                    <Td className="text-right font-mono">{fmtRate(o.priceMinor, o.currency)}</Td>
                    <Td><Badge tone={STATUS_TONE[o.status]} dot>{t(`status.${o.status}`)}</Badge></Td>
                    <Td className={cn('font-mono text-xs', o.overdue ? 'font-semibold text-red-600' : 'text-gray-600')}>{o.hoursLeft == null ? fmtDate(o.dueAt) : o.overdue ? t('overdueBy', { h: Math.abs(o.hoursLeft) }) : t('hoursLeft', { h: o.hoursLeft })}</Td>
                    <Td className="text-xs text-gray-600">{o.assigneeName ?? <span className="text-gray-400">{t('fields.unassigned')}</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
