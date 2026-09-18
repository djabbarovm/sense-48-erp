import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, ArrowLeft, Building2, Eye, EyeOff, History, MessageSquare } from 'lucide-react';
import { COMMERCIAL_STATUSES, LEASE_STATUSES, NotFoundError, OCCUPANCY_STATUSES, OPERATIONAL_STATUSES, READINESS_STATUSES, RENTAL_MODES, BROKER_ALLOWED_COMMERCIAL, can, hasRole } from '@finance-os/core';
import { getUnitCard } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, PageHeader, Select, cn } from '@/components/ui';
import { COLOR_BG, fmtDate, fmtRate } from '@/components/property';
import { addUnitActivityAction, changeUnitStatusAction, setUnitPublishedAction, updateUnitPricingAction } from '../../actions';

/* MDS Property — Unit Card (docs/20 §7.3): identity, статусы, собственник, коммерция, договор, активности, аудит. */

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]"><dt className="text-gray-500">{k}</dt><dd className="text-right font-medium text-gray-900">{v}</dd></div>
  );
}

export default async function UnitCardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'property.view')) notFound();
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getTranslations('property');
  let card: Awaited<ReturnType<typeof getUnitCard>>;
  try {
    card = await getUnitCard(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { unit, building, floor, owner, activities, audit, auditVisible, permissions } = card;
  const v = unit.view;
  const canStatus = permissions.readiness || permissions.occupancy || permissions.commercial || permissions.operational;
  const brokerOnly = hasRole(ctx, 'BROKER') && !hasRole(ctx, 'OWNER', 'COMMERCIAL_MANAGER');
  const commercialOptions = brokerOnly ? COMMERCIAL_STATUSES.filter((c) => BROKER_ALLOWED_COMMERCIAL.includes(c) || c === unit.commercialStatus) : COMMERCIAL_STATUSES;
  const errorKey = error ? (t.has(`error.${error}`) ? `error.${error}` : 'error.GENERIC') : null;
  const usd = (m: bigint | null | undefined) => (m == null ? '' : (Number(m) / 100).toFixed(2));

  return (
    <div className="space-y-5">
      <PageHeader
        title={<span className="font-mono">{unit.unitNo}</span>}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={v.color === 'GREEN' ? 'green' : v.color === 'RED' ? 'red' : v.color === 'YELLOW' ? 'yellow' : v.color === 'BLUE' ? 'blue' : 'gray'} dot>{t(`label.${v.labelKey}`)}</Badge>
            {v.overlay ? <Badge tone="yellow">{t(`commercial.${unit.commercialStatus}`)}</Badge> : null}
            {unit.publishedAt ? <Badge tone="blue">{t('published')}</Badge> : null}
            {unit.managedByPlatform ? <Badge tone="gray">{t('managed')}</Badge> : null}
          </span>
        }
        actions={
          <div className="flex items-center gap-1.5">
            <Link href={`/property/floors/${floor.id}`} className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"><ArrowLeft className="h-4 w-4" />{t('floorTitle', { n: floor.floorNo })}</Link>
            <Link href={`/property?building=${building.id}`} className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"><Building2 className="h-4 w-4" />{building.name}</Link>
          </div>
        }
      />

      {errorKey ? (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t(errorKey)}</div>
      ) : null}

      {v.alerts.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">{t('alertsTitle')}</p>
          <ul className="mt-1 list-disc pl-5">{v.alerts.map((a) => (<li key={a}>{t(`alert.${a}`)}</li>))}</ul>
          <p className="mt-1 text-xs text-amber-700">{t('alertsHint')}</p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Identity + Status */}
        <Card>
          <h3 className="font-display text-sm font-semibold">{t('identity')}</h3>
          <dl className="mt-3 space-y-1.5">
            <Row k={t('building')} v={building.name} />
            <Row k={t('floor')} v={floor.floorNo} />
            <Row k={t('unitType')} v={t(`type.${unit.type}`)} />
            <Row k={t('area')} v={`${unit.areaM2} м²`} />
            <Row k={t('statusSince')} v={fmtDate(unit.statusEffectiveAt)} />
          </dl>
          <h3 className="mt-5 font-display text-sm font-semibold">{t('statuses')}</h3>
          <dl className="mt-3 space-y-1.5">
            <Row k={t('dim.readiness')} v={t(`readiness.${unit.readiness}`)} />
            <Row k={t('dim.occupancy')} v={t(`occupancy.${unit.occupancy}`)} />
            <Row k={t('dim.rentalMode')} v={t(`rental.${unit.rentalMode}`)} />
            <Row k={t('dim.leaseStatus')} v={t(`lease.${unit.leaseStatus}`)} />
            <Row k={t('dim.commercialStatus')} v={t(`commercial.${unit.commercialStatus}`)} />
            <Row k={t('dim.operationalStatus')} v={t(`operational.${unit.operationalStatus}`)} />
            {v.vacantDays != null ? <Row k={t('vacantDays')} v={v.vacantDays} /> : null}
          </dl>
          <div className={cn('mt-4 h-1.5 rounded-full', COLOR_BG[v.color])} aria-hidden />
        </Card>

        {/* Owner + Occupant + Commercial + Contract */}
        <Card>
          <h3 className="font-display text-sm font-semibold">{t('owner')}</h3>
          {owner ? (
            <dl className="mt-3 space-y-1.5">
              <Row k={t('ownerName')} v={owner.displayName} />
              <Row k={t('ownerKindLabel')} v={t(`ownerKind.${owner.kind}`)} />
              <Row k={t('managementConsent')} v={owner.managementConsent ? t('yes') : t('no')} />
              {owner.contactPhone ? <Row k={t('phone')} v={<span className="font-mono">{owner.contactPhone}</span>} /> : <Row k={t('phone')} v={<span className="text-gray-400">{t('hiddenByPermission')}</span>} />}
              {owner.contactEmail ? <Row k={t('email')} v={owner.contactEmail} /> : null}
            </dl>
          ) : (
            <p className="mt-2 text-sm text-gray-400">{t('noOwner')}</p>
          )}
          <h3 className="mt-5 font-display text-sm font-semibold">{t('occupant')}</h3>
          <dl className="mt-3 space-y-1.5">
            <Row k={t('occupantName')} v={unit.occupantName ?? '—'} />
            <Row k={t('leaseEnds')} v={fmtDate(unit.leaseEndsAt)} />
            {v.leaseEndsInDays != null ? <Row k={t('leaseEndsIn')} v={t('days', { n: v.leaseEndsInDays })} /> : null}
          </dl>
          <h3 className="mt-5 font-display text-sm font-semibold">{t('commercialBlock')}</h3>
          <dl className="mt-3 space-y-1.5">
            <Row k={t('askingRate')} v={<span className="font-mono">{fmtRate(unit.askingRateMinor, unit.askingCurrency)}</span>} />
            {unit.minApprovedRateMinor != null ? <Row k={t('minApprovedRate')} v={<span className="font-mono">{fmtRate(unit.minApprovedRateMinor, unit.askingCurrency)}</span>} /> : null}
            {unit.monthlyRentMinor != null ? <Row k={t('monthlyRent')} v={<span className="font-mono">{fmtRate(unit.monthlyRentMinor, unit.askingCurrency)}</span>} /> : null}
            {unit.salePriceMinor != null ? <Row k={t('salePrice')} v={<span className="font-mono">{fmtRate(unit.salePriceMinor, unit.askingCurrency)}</span>} /> : null}
            <Row k={t('sellable')} v={v.isSellable ? t('yes') : t('no')} />
          </dl>
          {permissions.publish ? (
            <form action={setUnitPublishedAction} className="mt-3">
              <input type="hidden" name="unitId" value={unit.id} />
              <input type="hidden" name="published" value={unit.publishedAt ? '0' : '1'} />
              <Button type="submit" variant="outline" size="sm" disabled={!unit.publishedAt && !v.isSellable} title={!unit.publishedAt && !v.isSellable ? t('error.NOT_SELLABLE') : undefined}>
                {unit.publishedAt ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {unit.publishedAt ? t('unpublish') : t('publish')}
              </Button>
            </form>
          ) : null}
        </Card>

        {/* Status change */}
        <Card>
          <h3 className="font-display text-sm font-semibold">{t('changeStatus')}</h3>
          {canStatus ? (
            <form action={changeUnitStatusAction} className="mt-3 space-y-2.5">
              <input type="hidden" name="unitId" value={unit.id} />
              {permissions.readiness ? (
                <div><Label htmlFor="f-readiness">{t('dim.readiness')}</Label><Select id="f-readiness" name="readiness" defaultValue={unit.readiness}>{READINESS_STATUSES.map((s) => (<option key={s} value={s}>{t(`readiness.${s}`)}</option>))}</Select></div>
              ) : null}
              {permissions.occupancy ? (
                <>
                  <div><Label htmlFor="f-occupancy">{t('dim.occupancy')}</Label><Select id="f-occupancy" name="occupancy" defaultValue={unit.occupancy}>{OCCUPANCY_STATUSES.map((s) => (<option key={s} value={s}>{t(`occupancy.${s}`)}</option>))}</Select></div>
                  <div><Label htmlFor="f-rental">{t('dim.rentalMode')}</Label><Select id="f-rental" name="rentalMode" defaultValue={unit.rentalMode}>{RENTAL_MODES.map((s) => (<option key={s} value={s}>{t(`rental.${s}`)}</option>))}</Select></div>
                  <div><Label htmlFor="f-lease">{t('dim.leaseStatus')}</Label><Select id="f-lease" name="leaseStatus" defaultValue={unit.leaseStatus}>{LEASE_STATUSES.map((s) => (<option key={s} value={s}>{t(`lease.${s}`)}</option>))}</Select></div>
                  <div><Label htmlFor="f-occupant">{t('occupantName')}</Label><Input id="f-occupant" name="occupantName" defaultValue={unit.occupantName ?? ''} /></div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label htmlFor="f-ends">{t('leaseEnds')}</Label><Input id="f-ends" name="leaseEndsAt" type="date" defaultValue={unit.leaseEndsAt ? new Date(unit.leaseEndsAt).toISOString().slice(0, 10) : ''} /></div>
                    <div><Label htmlFor="f-rent">{t('monthlyRentUsd')}</Label><Input id="f-rent" name="monthlyRent" type="number" min="0" step="0.01" defaultValue={usd(unit.monthlyRentMinor)} /></div>
                  </div>
                </>
              ) : null}
              {permissions.commercial ? (
                <div><Label htmlFor="f-commercial">{t('dim.commercialStatus')}</Label><Select id="f-commercial" name="commercialStatus" defaultValue={unit.commercialStatus}>{commercialOptions.map((s) => (<option key={s} value={s}>{t(`commercial.${s}`)}</option>))}</Select></div>
              ) : null}
              {permissions.operational ? (
                <div><Label htmlFor="f-operational">{t('dim.operationalStatus')}</Label><Select id="f-operational" name="operationalStatus" defaultValue={unit.operationalStatus}>{OPERATIONAL_STATUSES.map((s) => (<option key={s} value={s}>{t(`operational.${s}`)}</option>))}</Select></div>
              ) : null}
              <div><Label htmlFor="f-reason">{t('reason')}</Label><Input id="f-reason" name="reason" placeholder={t('reasonPlaceholder')} /></div>
              {permissions.override ? (
                <label className="flex items-start gap-2 text-xs text-gray-600"><input type="checkbox" name="override" className="mt-0.5 h-4 w-4" />{t('overrideLabel')}</label>
              ) : null}
              <Button type="submit" size="sm">{t('save')}</Button>
              <p className="text-[11px] text-gray-400">{t('statusAuditHint')}</p>
            </form>
          ) : (
            <p className="mt-2 text-sm text-gray-400">{t('noStatusPermission')}</p>
          )}

          {permissions.pricing ? (
            <form action={updateUnitPricingAction} className="mt-5 space-y-2.5 border-t border-gray-100 pt-4">
              <input type="hidden" name="unitId" value={unit.id} />
              <h4 className="text-[13px] font-semibold text-gray-800">{t('pricing')}</h4>
              <div className="grid grid-cols-3 gap-2">
                <div><Label htmlFor="p-ask">{t('askingRateUsd')}</Label><Input id="p-ask" name="askingRate" type="number" min="0" step="0.01" defaultValue={usd(unit.askingRateMinor)} /></div>
                <div><Label htmlFor="p-min">{t('minApprovedUsd')}</Label><Input id="p-min" name="minApprovedRate" type="number" min="0" step="0.01" defaultValue={usd(unit.minApprovedRateMinor)} /></div>
                <div><Label htmlFor="p-sale">{t('salePriceUsd')}</Label><Input id="p-sale" name="salePrice" type="number" min="0" step="0.01" defaultValue={usd(unit.salePriceMinor)} /></div>
              </div>
              <Button type="submit" variant="outline" size="sm">{t('savePricing')}</Button>
            </form>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Activities */}
        <Card>
          <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('activities')}</h3></div>
          {permissions.activity ? (
            <form action={addUnitActivityAction} className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_1fr_1fr_auto]">
              <input type="hidden" name="unitId" value={unit.id} />
              <Select name="kind" defaultValue="NOTE" aria-label={t('activityKind')}>{(['VIEWING', 'CALL', 'NOTE', 'FOLLOW_UP', 'OFFER'] as const).map((k) => (<option key={k} value={k}>{t(`activity.${k}`)}</option>))}</Select>
              <Input name="note" placeholder={t('activityPlaceholder')} required aria-label={t('activityNote')} />
              <Input name="expectedRate" type="number" min="0" step="0.01" placeholder={t('expectedRateUsd')} aria-label={t('expectedRateUsd')} />
              <Input name="followUpAt" type="date" aria-label={t('followUp')} />
              <Button type="submit" size="sm">{t('add')}</Button>
            </form>
          ) : null}
          <ul className="mt-3 divide-y divide-gray-100">
            {activities.length === 0 ? <li className="py-2 text-sm text-gray-400">{t('noActivities')}</li> : null}
            {activities.map((a) => (
              <li key={a.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">{t(`activity.${a.kind}`)}</span>
                  <span className="font-mono text-xs text-gray-400">{fmtDate(a.happenedAt)}</span>
                </div>
                <p className="text-gray-700">{a.note}</p>
                <p className="text-xs text-gray-500">
                  {a.expectedRateMinor != null ? `${t('expectedRate')}: ${fmtRate(a.expectedRateMinor, unit.askingCurrency)}` : null}
                  {a.followUpAt ? ` · ${t('followUp')}: ${fmtDate(a.followUpAt)}` : null}
                </p>
              </li>
            ))}
          </ul>
        </Card>

        {/* Audit */}
        <Card>
          <div className="flex items-center gap-2"><History className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('auditTitle')}</h3></div>
          {audit.length === 0 ? <p className="mt-2 text-sm text-gray-400">{auditVisible ? t('auditEmpty') : t('auditHidden')}</p> : null}
          <ul className="mt-3 divide-y divide-gray-100">
            {audit.map((a) => {
              const b = (a.before ?? {}) as Record<string, unknown>;
              const af = (a.after ?? {}) as Record<string, unknown>;
              const changed = Object.keys(af).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(af[k]) && !['reason', 'override', 'source'].includes(k));
              return (
                <li key={a.id} className="py-2 text-xs">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono font-semibold text-gray-800">{a.action}</span><span className="font-mono text-gray-400">{new Date(a.at).toLocaleString('ru-RU')}</span></div>
                  <div className="mt-0.5 space-y-0.5">
                    {changed.map((k) => (<p key={k} className="font-mono text-gray-600"><span className="text-gray-400">{k}:</span> <span className="text-red-700">{b[k] === undefined ? '·' : String(b[k])}</span> → <span className="text-volt-700">{String(af[k])}</span></p>))}
                    {typeof af.reason === 'string' && af.reason ? <p className="text-gray-600">{t('reason')}: {af.reason}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
