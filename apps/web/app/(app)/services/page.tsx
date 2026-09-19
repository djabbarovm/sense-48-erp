import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Plus, Sparkles, Star } from 'lucide-react';
import { SERVICE_CATEGORIES, SERVICE_PROVIDER_KINDS, can } from '@finance-os/core';
import { getServicesSummary, listAssignees, listBuildings, listCatalog, listServiceOrders, listUnits } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Table, Td, Th, cn } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';
import { createCatalogItemAction, createServiceOrderAction, toggleCatalogItemAction } from './actions';
import { PROVIDER_TONE, STATUS_TONE } from './tones';

/* Wave 5 — Services marketplace (blueprint §12): каталог, заказы, GMV/монетизация, SLA партнёров. */

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ view?: string; error?: string; unit?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'service.view')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('services');
  const view = sp.view ?? 'open';
  const filter = view === 'overdue' ? { overdueOnly: true } : view === 'mine' ? { mine: true } : view === 'done' ? { status: ['DONE', 'VERIFIED', 'CANCELLED'] as const } : { status: ['NEW', 'ACCEPTED', 'IN_PROGRESS'] as const };
  const [rows, catalog, assignees, buildings, units, summary] = await Promise.all([
    view === 'catalog' ? Promise.resolve([]) : listServiceOrders(ctx, { ...('status' in filter ? { status: [...filter.status] } : {}), ...('overdueOnly' in filter ? { overdueOnly: true } : {}), ...('mine' in filter ? { mine: true } : {}) }),
    listCatalog(ctx, { includeInactive: can(ctx, 'service.catalog') }),
    can(ctx, 'service.manage') ? listAssignees(ctx) : Promise.resolve([]),
    listBuildings(ctx),
    can(ctx, 'service.order') ? listUnits(ctx) : Promise.resolve([]),
    getServicesSummary(ctx, { days: 30 }),
  ]);
  const overdueCount = rows.filter((r) => r.overdue).length;
  const tabs = ['open', 'overdue', 'mine', 'done', 'catalog'] as const;
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
        <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4 lg:grid-cols-7">
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-900">{fmtRate(summary.gmvMinor, summary.currency)}</p><p className="text-[11px] text-gray-500">{t('summary.gmv')}</p></div>
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-emerald-600">{fmtRate(summary.platformRevenueMinor, summary.currency)}</p><p className="text-[11px] text-gray-500">{t('summary.revenue')}</p></div>
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
                    <Td><Badge tone={PROVIDER_TONE[c.providerKind]}>{t(`providerKind.${c.providerKind}`)}</Badge>{c.partnerName ? <span className="ml-1 text-xs text-gray-700">{c.partnerName}</span> : null}</Td>
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
      ) : (
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
