import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, ArrowLeft, Building2, Coins, Eye, EyeOff, FileSignature, Handshake, History, MessageSquare, Wrench } from 'lucide-react';
import { COMMERCIAL_STATUSES, LEASE_STATUSES, LEASE_TYPES, NotFoundError, OCCUPANCY_STATUSES, OPERATIONAL_STATUSES, READINESS_STATUSES, RENTAL_MODES, BROKER_ALLOWED_COMMERCIAL, TENANT_CATEGORIES, can, hasRole } from '@finance-os/core';
import { createStorageFromEnv } from '@finance-os/adapters';
import { getUnitCard, getUnitFinance, listDeals, listDocumentsFor, listLeases, listMandates, listWorkOrders } from '@finance-os/db';
import { createMandateAction, transitionMandateAction } from '../../../mall/actions';
import { MANDATE_TONE } from '../../../mall/tones';
import { setUnitCadastreAction } from '../../../house/actions';
import { activateLeaseAction, createLeaseAction, markDepositReceivedAction, terminateLeaseAction, uploadLeaseDocumentAction } from '../../../leases/actions';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, PageHeader, Select, cn } from '@/components/ui';
import { COLOR_BG, fmtDate, fmtRate } from '@/components/property';
import { LiveRefresh } from '@/components/property/live';
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
  const finance = can(ctx, 'unit.finance.view') ? await getUnitFinance(ctx, unit.id) : null;
  const isMall = building.kind === 'MALL' || unit.type === 'RETAIL';
  const mandates = isMall && can(ctx, 'mall.view') ? await listMandates(ctx, { unitId: unit.id }) : [];
  const mandate = mandates.find((m) => m.status !== 'TERMINATED') ?? null;
  const tM = await getTranslations('mall');
  const [deals, leases, workOrders] = await Promise.all([
    can(ctx, 'deal.view') ? listDeals(ctx, { unitId: unit.id, includeClosed: true }) : Promise.resolve([]),
    can(ctx, 'lease.view') ? listLeases(ctx, { unitId: unit.id }) : Promise.resolve([]),
    can(ctx, 'workorder.view') ? listWorkOrders(ctx, { unitId: unit.id }) : Promise.resolve([]),
  ]);
  const tW = await getTranslations('workorders');
  const openWo = workOrders.filter((w) => w.status !== 'VERIFIED' && w.status !== 'CANCELLED');
  const activeDeals = deals.filter((d) => d.stage !== 'WON' && d.stage !== 'LOST');
  const liveLease = leases.find((l) => l.status === 'ACTIVE' || l.status === 'EXPIRING') ?? null;
  const leaseDocs = liveLease && can(ctx, 'lease.view') ? await listDocumentsFor(ctx, 'lease_contract', liveLease.id) : [];
  const leaseStorage = createStorageFromEnv();
  const leaseDocUrls = await Promise.all(leaseDocs.map(async (d) => ({ ...d, url: await leaseStorage.getSignedUrl(d.fileKey).catch(() => null) })));
  const LEASE_DOC_TYPES = ['CONTRACT', 'AMENDMENT', 'ACT', 'POA', 'OTHER'] as const;
  const draftLeases = leases.filter((l) => l.status === 'DRAFT');
  const tD = await getTranslations('deals');
  const tL = await getTranslations('leases');
  const tR = await getTranslations('rent');
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
            <LiveRefresh />
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
            <Row k={t('cadastre.number')} v={unit.cadastralNumber ? <span className="font-mono">{unit.cadastralNumber}</span> : <span className="text-amber-600">{t('cadastre.none')}</span>} />
            {unit.cadastralAreaM2 != null ? <Row k={t('cadastre.area')} v={`${Number(unit.cadastralAreaM2)} ${t('sqm')}`} /> : null}
          </dl>
          {can(ctx, 'property.manage') ? (
            <form action={setUnitCadastreAction} className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <input type="hidden" name="unitId" value={unit.id} />
              <div><Label htmlFor="cad-no">{t('cadastre.number')}</Label><Input id="cad-no" name="cadastralNumber" defaultValue={unit.cadastralNumber ?? ''} /></div>
              <div><Label htmlFor="cad-area">{t('cadastre.area')}</Label><Input id="cad-area" name="cadastralAreaM2" type="number" min="0.01" step="0.01" defaultValue={unit.cadastralAreaM2 != null ? Number(unit.cadastralAreaM2) : ''} /></div>
              <Button type="submit" size="sm" variant="outline">{t('cadastre.save')}</Button>
            </form>
          ) : null}
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
              {permissions.occupancy && liveLease ? <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">{tL('occupancyLocked')}</p> : null}
              {permissions.occupancy && !liveLease ? (
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
              {permissions.operational && openWo.some((w) => w.status !== 'DONE') ? <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">{tW('operationalLocked')}</p> : null}
              {permissions.operational && !openWo.some((w) => w.status !== 'DONE') ? (
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

      {(can(ctx, 'deal.view') || can(ctx, 'lease.view')) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Wave 2: договор аренды — источник истины занятости */}
          {can(ctx, 'lease.view') ? (
            <Card>
              <div className="flex items-center gap-2"><FileSignature className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{tL('cardTitle')}</h3></div>
              {liveLease ? (
                <dl className="mt-3 space-y-1.5">
                  <Row k={tL('status')} v={<Badge tone={liveLease.status === 'ACTIVE' ? 'green' : 'yellow'} dot>{tL(`leaseStatus.${liveLease.status}`)}</Badge>} />
                  <Row k={tL('occupant')} v={liveLease.occupantName} />
                  {liveLease.occupantContact ? <Row k={t('phone')} v={<span className="font-mono">{liveLease.occupantContact}</span>} /> : null}
                  <Row k={tL('type')} v={tL(`leaseType.${liveLease.type}`)} />
                  {liveLease.tenantCategory ? <Row k={tL('tenantCategory')} v={tL(`category.${liveLease.tenantCategory}`)} /> : null}
                  <Row k={tL('period')} v={`${fmtDate(liveLease.startAt)} → ${liveLease.endAt ? fmtDate(liveLease.endAt) : tL('openEnded')}`} />
                  {liveLease.rentMinor != null ? <Row k={tL('rent')} v={<span className="font-mono">{fmtRate(liveLease.rentMinor, liveLease.currency)}</span>} /> : null}
                  {liveLease.depositMinor != null ? <Row k={tL('deposit')} v={<span className={liveLease.depositReceived ? 'text-emerald-600' : 'text-red-600'}>{fmtRate(liveLease.depositMinor, liveLease.currency)} · {liveLease.depositReceived ? tL('received') : tL('notReceived')}</span>} /> : null}
                </dl>
              ) : <p className="mt-2 text-sm text-gray-400">{tL('none')}</p>}
              {liveLease ? (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <p className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{tL('documents')}</p>
                  <ul className="mt-1 divide-y divide-gray-100">
                    {leaseDocUrls.length === 0 ? <li className="py-1.5 text-xs text-gray-400">{tL('noDocuments')}</li> : null}
                    {leaseDocUrls.map((d) => (<li key={d.id} className="flex items-center justify-between gap-2 py-1.5 text-xs"><span><Badge tone="gray">{tL(`docTypes.${d.docType as never}`)}</Badge><span className="ml-2 text-gray-800">{d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{d.fileName}</a> : d.fileName}</span></span><span className="font-mono text-[10px] text-gray-400">v{d.version} · {fmtDate(d.createdAt)}</span></li>))}
                  </ul>
                  {can(ctx, 'lease.manage') && can(ctx, 'document.upload') ? (
                    <form action={uploadLeaseDocumentAction} className="mt-2 flex items-end gap-2">
                      <input type="hidden" name="unitId" value={unit.id} /><input type="hidden" name="leaseId" value={liveLease.id} />
                      <div><Label htmlFor="ld-type">{tL('docType')}</Label><Select id="ld-type" name="docType" defaultValue="CONTRACT">{LEASE_DOC_TYPES.map((x) => (<option key={x} value={x}>{tL(`docTypes.${x}`)}</option>))}</Select></div>
                      <div className="flex-1"><Label htmlFor="ld-file">{tL('docFile')}</Label><Input id="ld-file" type="file" name="file" accept="application/pdf,image/*,.doc,.docx" required /></div>
                      <Button type="submit" size="sm" variant="outline">{tL('uploadDoc')}</Button>
                    </form>
                  ) : null}
                  <p className="mt-1 text-[11px] text-gray-400">{tL('docsHint')}</p>
                </div>
              ) : null}
              {can(ctx, 'lease.manage') && liveLease ? (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
                  {liveLease.depositMinor != null && !liveLease.depositReceived ? <form action={markDepositReceivedAction}><input type="hidden" name="unitId" value={unit.id} /><input type="hidden" name="leaseId" value={liveLease.id} /><Button type="submit" variant="outline" size="sm">{tL('markDeposit')}</Button></form> : null}
                  <form action={terminateLeaseAction} className="flex flex-1 items-end gap-2">
                    <input type="hidden" name="unitId" value={unit.id} /><input type="hidden" name="leaseId" value={liveLease.id} />
                    <div className="flex-1"><Label htmlFor="lt-reason">{tL('terminateReason')}</Label><Input id="lt-reason" name="reason" required placeholder={tL('terminatePlaceholder')} /></div>
                    <Button type="submit" variant="danger" size="sm">{tL('terminate')}</Button>
                  </form>
                </div>
              ) : null}
              {can(ctx, 'lease.manage') && !liveLease ? (
                <>
                  {draftLeases.map((l) => (
                    <form key={l.id} action={activateLeaseAction} className="mt-2 flex items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm">
                      <input type="hidden" name="unitId" value={unit.id} /><input type="hidden" name="leaseId" value={l.id} />
                      <span>{tL('draft')}: {l.occupantName} · {fmtDate(l.startAt)}</span>
                      <Button type="submit" size="sm">{tL('activate')}</Button>
                    </form>
                  ))}
                  <form action={createLeaseAction} className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                    <h4 className="text-[13px] font-semibold text-gray-800">{tL('newLease')}</h4>
                    <input type="hidden" name="unitId" value={unit.id} />
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label htmlFor="nl-type">{tL('type')}</Label><Select id="nl-type" name="type" defaultValue="LTR">{LEASE_TYPES.map((x) => (<option key={x} value={x}>{tL(`leaseType.${x}`)}</option>))}</Select></div>
                      <div><Label htmlFor="nl-occ">{tL('occupant')}</Label><Input id="nl-occ" name="occupantName" /></div>
                      <div><Label htmlFor="nl-contact">{tL('occupantContact')}</Label><Input id="nl-contact" name="occupantContact" /></div>
                      <div><Label htmlFor="nl-rent">{tL('rentUsd')}</Label><Input id="nl-rent" name="rent" type="number" min="0" step="0.01" defaultValue={unit.askingRateMinor ? (Number(unit.askingRateMinor) / 100).toFixed(2) : ''} required /></div>
                      <div><Label htmlFor="nl-start">{tL('startAt')}</Label><Input id="nl-start" name="startAt" type="date" required /></div>
                      <div><Label htmlFor="nl-end">{tL('endAt')}</Label><Input id="nl-end" name="endAt" type="date" /></div>
                      <div><Label htmlFor="nl-dep">{tL('depositUsd')}</Label><Input id="nl-dep" name="deposit" type="number" min="0" step="0.01" /></div>
                      {unit.type === 'RETAIL' ? <div><Label htmlFor="nl-cat">{tL('tenantCategory')}</Label><Select id="nl-cat" name="tenantCategory" defaultValue="OTHER">{TENANT_CATEGORIES.map((c) => (<option key={c} value={c}>{tL(`category.${c}`)}</option>))}</Select></div> : null}
                      <div className="flex flex-col justify-end gap-1 text-xs text-gray-700">
                        <label className="flex items-center gap-2"><input type="checkbox" name="depositReceived" className="h-4 w-4" />{tL('received')}</label>
                        <label className="flex items-center gap-2"><input type="checkbox" name="activate" defaultChecked className="h-4 w-4" />{tL('activateNow')}</label>
                      </div>
                    </div>
                    <Button type="submit" size="sm">{tL('create')}</Button>
                    <p className="text-[11px] text-gray-400">{tL('sourceHint')}</p>
                  </form>
                </>
              ) : null}
            </Card>
          ) : null}
          {/* Wave 2: сделки по юниту */}
          {can(ctx, 'deal.view') ? (
            <Card>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2"><Handshake className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{tD('unitDeals')}</h3></div>
                {can(ctx, 'deal.manage') && v.isSellable ? <Link href={`/deals/new?unit=${unit.id}`} className="text-sm font-medium text-brand-600 hover:underline">{tD('newDeal')}</Link> : null}
              </div>
              <ul className="mt-3 divide-y divide-gray-100">
                {deals.length === 0 ? <li className="py-2 text-sm text-gray-400">{tD('noDealsForUnit')}</li> : null}
                {[...activeDeals, ...deals.filter((d) => d.stage === 'WON' || d.stage === 'LOST')].slice(0, 8).map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <div><Link href={`/deals/${d.id}`} className="font-mono text-xs text-brand-600 hover:underline">{d.number}</Link><span className="ml-2 font-medium text-gray-900">{d.company ?? d.contactName}</span><span className="ml-2 text-xs text-gray-500">{d.managerName}</span></div>
                    <Badge tone={d.stage === 'WON' ? 'green' : d.stage === 'LOST' ? 'red' : 'blue'}>{tD(`stage.${d.stage}`)}</Badge>
                  </li>
                ))}
              </ul>
              {activeDeals.length ? <p className="mt-2 text-[11px] text-gray-400">{tD('dealIsSourceHint')}</p> : null}
            </Card>
          ) : null}
        </div>
      ) : null}

      {isMall && can(ctx, 'mall.view') ? (
        <Card>
          <div className="flex items-center gap-2"><FileSignature className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{tM('mandate.title')}</h3>{mandate ? <Badge tone={MANDATE_TONE[mandate.status]} dot>{tM(`mandate.status_.${mandate.status}`)}</Badge> : null}</div>
          {mandate ? (
            <dl className="mt-3 space-y-1.5">
              <Row k={tM('mandate.owner')} v={mandate.ownerName} />
              <Row k={tM('mandate.feePct')} v={mandate.feeBp != null ? `${mandate.feeBp / 100}%${mandate.feePublished ? '' : ' · —'}` : tM('mandate.feeOpen')} />
              {mandate.successFee != null ? <Row k={tM('mandate.successFee')} v={mandate.successFee} /> : null}
              <Row k={tM('mandate.signedAt')} v={fmtDate(mandate.signedAt)} />
              {mandate.startAt ? <Row k={tM('mandate.startAt')} v={fmtDate(mandate.startAt)} /> : null}
              {mandate.status === 'ACTIVE' ? <p className="text-[11px] text-gray-400">{tM('mandate.activeHint')}</p> : null}
            </dl>
          ) : <p className="mt-2 text-sm text-gray-400">{tM('mandate.none')}</p>}
          {can(ctx, 'mall.manage') ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
              {!mandate && owner ? <form action={createMandateAction}><input type="hidden" name="unitId" value={unit.id} /><input type="hidden" name="back" value={`/property/units/${unit.id}`} /><Button type="submit" size="sm">{tM('mandate.create')}</Button></form> : null}
              {mandate?.status === 'DRAFT' ? <form action={transitionMandateAction}><input type="hidden" name="id" value={mandate.id} /><input type="hidden" name="trigger" value="sign" /><input type="hidden" name="back" value={`/property/units/${unit.id}`} /><Button type="submit" size="sm" variant="outline">{tM('mandate.sign')}</Button></form> : null}
              {mandate?.status === 'SIGNED' ? <form action={transitionMandateAction}><input type="hidden" name="id" value={mandate.id} /><input type="hidden" name="trigger" value="activate" /><input type="hidden" name="back" value={`/property/units/${unit.id}`} /><Button type="submit" size="sm">{tM('mandate.activate')}</Button></form> : null}
              <Link href="/mall?view=mandates" className="text-xs font-medium text-brand-600 hover:underline">{tM('tab.mandates')} →</Link>
            </div>
          ) : null}
        </Card>
      ) : null}
      {finance ? (
        <Card>
          <div className="flex items-center gap-2"><Coins className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('finance.title')}</h3>{finance.overdueCount ? <Badge tone="red" dot>{t('finance.overdue', { n: finance.overdueCount })}</Badge> : null}</div>
          <dl className="mt-3 space-y-1.5">
            {finance.monthlyRentMinor != null ? <Row k={t('finance.monthlyRent')} v={<span className="font-mono">{fmtRate(finance.monthlyRentMinor, finance.currency)}</span>} /> : null}
            <Row k={t('finance.charged')} v={<span className="font-mono">{fmtRate(finance.chargedMinor, finance.currency)}</span>} />
            <Row k={t('finance.received')} v={<span className="font-mono text-emerald-600">{fmtRate(finance.receivedMinor, finance.currency)}</span>} />
            <Row k={t('finance.outstanding')} v={<span className={cn('font-mono font-semibold', finance.outstandingMinor > 0n ? (finance.overdueMinor > 0n ? 'text-red-600' : 'text-amber-600') : 'text-gray-400')}>{fmtRate(finance.outstandingMinor, finance.currency)}</span>} />
            {finance.ownerPayoutMinor != null ? <Row k={t('finance.ownerPayout')} v={<span className="font-mono">{fmtRate(finance.ownerPayoutMinor, finance.currency)}{unit.managedByPlatform ? <span className="ml-1 text-[10px] text-gray-400">{t('finance.feeHint', { fee: finance.feeBp / 100 })}</span> : null}</span>} /> : null}
            {finance.lastPaymentAt ? <Row k={t('finance.lastPayment')} v={fmtDate(finance.lastPaymentAt)} /> : null}
          </dl>
          <p className="mt-3 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{t('finance.charges')}</p>
          <ul className="mt-1 divide-y divide-gray-100">
            {finance.charges.length === 0 ? <li className="py-1.5 text-xs text-gray-400">{t('finance.none')}</li> : null}
            {finance.charges.slice(0, 6).map((c) => (<li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-xs"><span className="font-mono text-gray-700">{fmtDate(c.periodStart)} → {fmtDate(c.periodEnd)}</span><span className="flex items-center gap-2"><span className="font-mono">{fmtRate(c.receivedMinor, c.currency)} / {fmtRate(c.amountMinor, c.currency)}</span><Badge tone={({ DUE: 'blue', PARTIAL: 'yellow', OVERDUE: 'red', PAID: 'green', WAIVED: 'gray' } as const)[c.status]}>{tR(`status.${c.status}`)}</Badge></span></li>))}
          </ul>
          {can(ctx, 'rent.view') ? <Link href={`/rent?view=all&unit=${unit.id}`} className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline">{t('finance.allRent')}</Link> : null}
        </Card>
      ) : null}

      {can(ctx, 'workorder.view') ? (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2"><Wrench className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{tW('unitSection')}</h3>{openWo.length ? <Badge tone={openWo.some((w) => w.priority === 'CRITICAL') ? 'red' : 'yellow'} dot>{tW('openN', { n: openWo.length })}</Badge> : null}</div>
            {can(ctx, 'workorder.create') ? <Link href={`/workorders?unit=${unit.id}`} className="text-sm font-medium text-brand-600 hover:underline">{tW('newShort')}</Link> : null}
          </div>
          <ul className="mt-3 divide-y divide-gray-100">
            {workOrders.length === 0 ? <li className="py-2 text-sm text-gray-400">{tW('noneForUnit')}</li> : null}
            {workOrders.slice(0, 6).map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div><Link href={`/workorders/${w.id}`} className="font-mono text-xs text-brand-600 hover:underline">{w.number}</Link><span className="ml-2 text-gray-900">{w.title}</span><span className="ml-2 text-xs text-gray-500">{tW(`category.${w.category}`)}</span></div>
                <div className="flex items-center gap-1.5"><Badge tone={w.priority === 'CRITICAL' ? 'red' : w.priority === 'HIGH' ? 'yellow' : 'gray'}>{tW(`priority.${w.priority}`)}</Badge><Badge tone={w.status === 'VERIFIED' || w.status === 'DONE' ? 'green' : w.status === 'CANCELLED' ? 'gray' : 'blue'} dot>{tW(`status.${w.status}`)}</Badge>{w.overdue ? <Badge tone="red">{tW('overdue')}</Badge> : null}</div>
              </li>
            ))}
          </ul>
          {openWo.length ? <p className="mt-2 text-[11px] text-gray-400">{tW('sourceHint')}</p> : null}
        </Card>
      ) : null}

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
