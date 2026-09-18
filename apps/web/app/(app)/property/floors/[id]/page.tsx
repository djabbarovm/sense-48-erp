import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { NotFoundError, can, type UnitColor } from '@finance-os/core';
import { getFloor, type UnitRow } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { filterQuery, parseUnitFilter, type PropertySearchParams } from '@/lib/property-filters';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, cn } from '@/components/ui';
import { COLOR_BG, COLOR_ORDER, FloorPlan, Legend, fmtDate, fmtRate } from '@/components/property';

/* MDS Property — Floor View (docs/20 §7.2): план этажа + список (2D fallback и mobile). */

export default async function FloorViewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<PropertySearchParams> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'property.view')) notFound();
  const { id } = await params;
  const sp = await searchParams;
  const filter = parseUnitFilter(sp);
  const t = await getTranslations('property');
  let data: Awaited<ReturnType<typeof getFloor>>;
  try {
    data = await getFloor(ctx, id, filter);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { floor, building, units, siblings } = data;
  const idx = siblings.findIndex((s) => s.id === floor.id);
  const up = idx > 0 ? siblings[idx - 1] : null;
  const down = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  const colorLabels = Object.fromEntries(COLOR_ORDER.map((c) => [c, t(`color.${c}`)])) as Record<UnitColor, string>;
  const counts = Object.fromEntries(COLOR_ORDER.map((c) => [c, units.filter((u) => u.view.color === c).length])) as Record<UnitColor, number>;
  const title = (u: UnitRow) => `${u.unitNo} · ${t(`type.${u.type}`)} · ${u.areaM2} м² · ${t(`label.${u.view.labelKey}`)}${u.occupantName ? ` · ${u.occupantName}` : ''}`;
  const keep = filterQuery(sp, { floor: null });

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${building.name} · ${t('floorTitle', { n: floor.floorNo })}`}
        meta={<Badge tone="gray">{t('unitsCount', { n: units.length })}</Badge>}
        actions={
          <div className="flex items-center gap-1.5">
            <Link href={`/property${filterQuery(sp, { building: building.id, floor: null })}`} className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"><ArrowLeft className="h-4 w-4" />{t('backToBuilding')}</Link>
            {up ? <Link href={`/property/floors/${up.id}${keep}`} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200" aria-label={t('floorUp')}><ChevronUp className="h-4 w-4" />{up.floorNo}</Link> : null}
            {down ? <Link href={`/property/floors/${down.id}${keep}`} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200" aria-label={t('floorDown')}><ChevronDown className="h-4 w-4" />{down.floorNo}</Link> : null}
          </div>
        }
      />

      <Legend labels={{ ...colorLabels, overlay: t('legendOverlay'), alert: t('legendAlert'), published: t('legendPublished') }} counts={counts} />

      {units.length === 0 ? (
        <EmptyState text={t('noMatchOnFloor')} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
          <Card className="p-3">
            <FloorPlan viewBox={floor.planViewBox} units={units} hrefFor={(u) => `/property/units/${u.id}`} titleFor={title} />
            <p className="mt-2 text-[11px] text-gray-400">{t('planHint')}</p>
          </Card>
          <Table>
            <thead>
              <tr><Th>{t('unit')}</Th><Th>{t('status')}</Th><Th className="text-right">{t('area')}</Th><Th className="text-right">{t('askingRate')}</Th><Th>{t('occupantOrEnds')}</Th></tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id} className="group">
                  <Td><Link href={`/property/units/${u.id}`} className="font-mono font-semibold text-ink-900 hover:text-brand-600">{u.unitNo}</Link><span className="ml-2 text-xs text-gray-400">{t(`type.${u.type}`)}</span></Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className={cn('h-2.5 w-2.5 rounded-[2px]', COLOR_BG[u.view.color], u.view.overlay ? 'ring-2 ring-orange-500' : '')} aria-hidden />
                      {t(`label.${u.view.labelKey}`)}
                      {u.view.alerts.length ? <span className="font-semibold text-red-600">!</span> : null}
                    </span>
                  </Td>
                  <Td className="text-right font-mono">{u.areaM2}</Td>
                  <Td className="text-right font-mono">{fmtRate(u.askingRateMinor, u.askingCurrency)}</Td>
                  <Td className="text-xs text-gray-600">{u.occupantName ?? (u.leaseEndsAt ? fmtDate(u.leaseEndsAt) : u.view.vacantDays != null ? t('vacantDaysShort', { n: u.view.vacantDays }) : '—')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
