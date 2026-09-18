import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Building2, Filter, Search, X } from 'lucide-react';
import { can, type UnitColor } from '@finance-os/core';
import { getStatusMap, listBuildings, type UnitRow } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { filterQuery, hasActiveFilter, parseUnitFilter, type PropertySearchParams } from '@/lib/property-filters';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, cn } from '@/components/ui';
import { COLOR_ORDER, KpiStrip, Legend, UnitCell, fmtDate, fmtRate } from '@/components/property';
import { LiveRefresh } from '@/components/property/live';

/* MDS Property — Building View (docs/20 §7.1): 2.5D фасад, KPI strip, фильтры, легенда. */

export default async function BuildingViewPage({ searchParams }: { searchParams: Promise<PropertySearchParams> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'property.view')) notFound();
  const sp = await searchParams;
  const filter = parseUnitFilter(sp);
  const t = await getTranslations('property');
  const [buildings, map] = await Promise.all([listBuildings(ctx), getStatusMap(ctx, filter)]);
  const active = hasActiveFilter(filter);
  const colorLabels = Object.fromEntries(COLOR_ORDER.map((c) => [c, t(`color.${c}`)])) as Record<UnitColor, string>;
  const kpiLabels = Object.fromEntries(['total', 'occupancy', 'occupied', 'vacant', 'renovation', 'ltr', 'str', 'ownerUse', 'gla', 'potential', 'current', 'alerts', 'perMonth'].map((k) => [k, t(`kpi.${k}`)]));
  const currency = map.buildings[0]?.floors[0]?.units[0]?.askingCurrency ?? 'USD';

  const cellTitle = (u: UnitRow) =>
    [
      `${u.unitNo} · ${t(`type.${u.type}`)} · ${u.areaM2} м²`,
      `${t(`label.${u.view.labelKey}`)}${u.view.overlay ? ` · ${t(`commercial.${u.commercialStatus}`)}` : ''}`,
      u.ownerName ? `${t('owner')}: ${u.ownerName}` : null,
      u.occupantName ? `${t('occupant')}: ${u.occupantName}` : null,
      u.askingRateMinor ? `${t('askingRate')}: ${fmtRate(u.askingRateMinor, u.askingCurrency)}` : null,
      u.leaseEndsAt ? `${t('leaseEnds')}: ${fmtDate(u.leaseEndsAt)}` : null,
      u.view.vacantDays != null ? `${t('vacantDays')}: ${u.view.vacantDays}` : null,
      ...u.view.alerts.map((a) => `⚠ ${t(`alert.${a}`)}`),
    ]
      .filter(Boolean)
      .join('\n');

  const unitHref = (u: UnitRow) => `/property/units/${u.id}`;
  const q = (patch: Record<string, string | null>) => `/property${filterQuery(sp, patch)}`;

  if (buildings.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} />
        <EmptyState icon={<Building2 />} text={t('empty')} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        meta={<span className="flex items-center gap-3 text-sm text-gray-500">{t('matched', { n: map.matched })}<LiveRefresh /></span>}
        actions={
          <div className="flex flex-wrap gap-1.5">
            <Link href={q({ building: null })} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', !filter.buildingId ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>{t('allBuildings')}</Link>
            {buildings.map((b) => (
              <Link key={b.id} href={q({ building: b.id })} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', filter.buildingId === b.id ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>
                {b.name}
              </Link>
            ))}
          </div>
        }
      />

      <KpiStrip kpi={map.kpi} labels={kpiLabels} currency={currency} />

      {/* Smart filters (blueprint §1.8) — GET-форма: тот же URL читает и карта, и этаж, и список */}
      <Card>
        <form method="get" action="/property" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {filter.buildingId ? <input type="hidden" name="building" value={filter.buildingId} /> : null}
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-gray-400" />
            <Input name="q" defaultValue={filter.q ?? ''} placeholder={t('searchPlaceholder')} className="pl-9" aria-label={t('search')} />
          </div>
          <Select name="color" defaultValue={filter.color ?? ''} aria-label={t('filterStatus')}>
            <option value="">{t('filterStatus')}</option>
            {COLOR_ORDER.map((c) => (<option key={c} value={c}>{colorLabels[c]}</option>))}
          </Select>
          <Select name="mode" defaultValue={filter.rentalMode ?? ''} aria-label={t('filterMode')}>
            <option value="">{t('filterMode')}</option>
            <option value="LTR">{t('rental.LTR')}</option>
            <option value="STR">{t('rental.STR')}</option>
          </Select>
          <Select name="vacant" defaultValue={filter.vacantOverDays ? String(filter.vacantOverDays) : ''} aria-label={t('filterVacant')}>
            <option value="">{t('filterVacant')}</option>
            {[30, 60, 90].map((d) => (<option key={d} value={d}>{t('vacantOver', { d })}</option>))}
          </Select>
          <Select name="expiring" defaultValue={filter.leaseEndsWithinDays ? String(filter.leaseEndsWithinDays) : ''} aria-label={t('filterExpiring')}>
            <option value="">{t('filterExpiring')}</option>
            {[30, 60, 90].map((d) => (<option key={d} value={d}>{t('expiringIn', { d })}</option>))}
          </Select>
          <Select name="commercial" defaultValue={filter.commercialStatus ?? ''} aria-label={t('filterCommercial')}>
            <option value="">{t('filterCommercial')}</option>
            {(['AVAILABLE', 'VIEWING', 'NEGOTIATION', 'RESERVED', 'LOI', 'CONTRACTED', 'OFF_MARKET'] as const).map((c) => (<option key={c} value={c}>{t(`commercial.${c}`)}</option>))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="managed" value="1" defaultChecked={filter.managedOnly ?? false} className="h-4 w-4" />{t('managedOnly')}</label>
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="alerts" value="1" defaultChecked={filter.withAlerts ?? false} className="h-4 w-4" />{t('withAlerts')}</label>
          <div className="flex gap-2 xl:col-span-2 xl:justify-end">
            <Button type="submit" size="sm"><Filter className="h-3.5 w-3.5" />{t('apply')}</Button>
            {active ? <Link href={q({ color: null, mode: null, vacant: null, expiring: null, commercial: null, managed: null, alerts: null, q: null, floor: null, readiness: null, occupancy: null })} className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"><X className="h-3.5 w-3.5" />{t('reset')}</Link> : null}
          </div>
        </form>
      </Card>

      <Legend labels={{ ...colorLabels, overlay: t('legendOverlay'), alert: t('legendAlert'), published: t('legendPublished') }} />

      {/* 2.5D фасады: этажи сверху вниз, ячейки — юниты; клик по этажу → план, по ячейке → карточка */}
      <div className={cn('grid gap-5', map.buildings.length > 1 ? 'xl:grid-cols-3' : '')}>
        {map.buildings.map(({ building, floors, kpi }) => (
          <Card key={building.id} className="overflow-hidden">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-[15px] font-semibold text-gray-900">{building.name}</h2>
                <p className="text-xs text-gray-500">{t(`kind.${building.kind}`)} · {t('floorsCount', { n: floors.length })} · {t('unitsCount', { n: kpi.commercial })}</p>
              </div>
              <Badge tone={kpi.occupancyPct >= 85 ? 'green' : kpi.occupancyPct >= 70 ? 'yellow' : 'red'} dot>{t('kpi.occupancy')} {kpi.occupancyPct}%</Badge>
            </div>
            <div className="pixel-grid rounded-lg bg-ink-900 p-3 pb-5">
              <div className="space-y-1">
                {floors.map(({ floor, units, byColor }, idx) => {
                  const commercial = units.filter((u) => u.view.isCommercial);
                  return (
                    <div key={floor.id} className="flex items-center gap-2" style={{ marginLeft: `${Math.min(idx, 14) * 1.5}px` }}>
                      <Link href={`/property/floors/${floor.id}${filterQuery(sp, { building: null })}`} className="w-9 shrink-0 text-right font-mono text-[11px] font-semibold text-slate-400 hover:text-volt-500" title={t('openFloor', { n: floor.floorNo })}>
                        {floor.floorNo}
                      </Link>
                      <div className="flex min-h-7 flex-1 flex-wrap items-center gap-1 rounded-sm border border-ink-700 bg-ink-800/80 px-1.5 py-0.5">
                        {commercial.length === 0 ? <span className="text-[10px] text-slate-600">{t('noMatchOnFloor')}</span> : commercial.map((u) => <UnitCell key={u.id} u={u} title={cellTitle(u)} href={unitHref(u)} size={commercial.length > 8 ? 'sm' : 'md'} />)}
                      </div>
                      <span className="hidden w-14 shrink-0 font-mono text-[10px] text-slate-500 sm:inline" title={t('floorCounts')}>
                        <span className="text-red-400">{byColor.RED}</span>/<span className="text-emerald-400">{byColor.GREEN}</span>/<span className="text-amber-300">{byColor.YELLOW}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
