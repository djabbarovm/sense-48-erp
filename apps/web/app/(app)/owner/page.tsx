import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Building2, Download, FileSignature, FileText, ShieldCheck, Sparkles, Star, Store, Wallet, Wrench } from 'lucide-react';
import { NotFoundError, WORK_ORDER_CATEGORIES, can } from '@finance-os/core';
import { createStorageFromEnv } from '@finance-os/adapters';
import { getOwnerPortal, getOwnerDocumentUrl } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Table, Td, Th, cn } from '@/components/ui';
import { COLOR_BG, fmtDate, fmtRate } from '@/components/property';
import { createOwnerRequestAction, createOwnerServiceOrderAction, rateOwnerServiceOrderAction, updateOwnerConsentsAction, uploadOwnerDocumentAction } from './actions';

/* Wave 4b — Owner Portal (blueprint §10): только свои юниты, договоры, выплаты, заявки, согласия. */

const WO_TONE = { OPEN: 'red', ASSIGNED: 'yellow', IN_PROGRESS: 'blue', DONE: 'green', VERIFIED: 'green', CANCELLED: 'gray' } as const;
const SO_TONE = { NEW: 'red', ACCEPTED: 'yellow', IN_PROGRESS: 'blue', DONE: 'green', VERIFIED: 'green', CANCELLED: 'gray' } as const;
const OWNER_DOC_TYPES = ['CONTRACT', 'ACT', 'POA', 'OTHER'] as const;

export default async function OwnerPortalPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'owner.portal')) notFound();
  const { error } = await searchParams;
  const t = await getTranslations('ownerPortal');
  const tp = await getTranslations('property');
  const tw = await getTranslations('workorders');
  const ts = await getTranslations('services');
  const tM = await getTranslations('mall');
  let p: Awaited<ReturnType<typeof getOwnerPortal>>;
  try {
    p = await getOwnerPortal(ctx);
  } catch (e) {
    if (e instanceof NotFoundError) return <div className="space-y-4"><PageHeader title={t('title')} /><EmptyState icon={<ShieldCheck />} text={t('notLinked')} /></div>;
    throw e;
  }
  const storage = createStorageFromEnv();
  const docs = await Promise.all(p.documents.map(async (d) => ({ ...d, url: await getOwnerDocumentUrl(ctx, storage, d.id).catch(() => null) })));
  const docObjects = [...p.units.map((u) => ({ key: `unit:${u.id}`, label: t('unitOf', { unit: u.unitNo }) })), ...p.units.filter((u) => u.lease).map((u) => ({ key: `lease_contract:${u.lease!.id}`, label: t('leaseOf', { unit: u.unitNo }) }))];

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} meta={<span className="text-sm text-gray-500">{p.owner.displayName} · {p.company}</span>} />
      {error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${error}`) ? t(`error.${error}`) : t('error.GENERIC')}</div> : null}

      {/* Юниты */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><Building2 className="h-3.5 w-3.5" />{t('myUnits')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {p.units.map((u) => (
            <Card key={u.id}>
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-mono text-lg font-bold text-gray-900">{u.unitNo}</p><p className="text-xs text-gray-500">{u.building} · {tp('floorTitle', { n: u.floorNo })} · {tp(`type.${u.type}`)} · {u.areaM2} {t('sqm')}</p></div>
                <span className={cn('rounded-[3px] px-2 py-0.5 text-[11px] font-semibold', COLOR_BG[u.color as keyof typeof COLOR_BG])}>{tp(`label.${u.labelKey}`)}</span>
              </div>
              <dl className="mt-3 space-y-1 text-[13px]">
                {u.lease ? (
                  <>
                    <div className="flex justify-between"><dt className="text-gray-500">{t('occupant')}</dt><dd className="font-medium text-gray-900">{u.lease.type === 'OWNER_USE' ? t('ownerUse') : (u.occupantName ?? '—')}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-500">{t('leasePeriod')}</dt><dd className="font-mono">{fmtDate(u.lease.startAt)} → {u.lease.endAt ? fmtDate(u.lease.endAt) : t('openEnded')}</dd></div>
                    {u.lease.type !== 'OWNER_USE' ? <div className="flex justify-between"><dt className="text-gray-500">{t('rent')}</dt><dd className="font-mono font-semibold">{fmtRate(u.lease.rentMinor, u.lease.currency)}/{t('mo')}</dd></div> : null}
                    {u.lease.depositMinor != null ? <div className="flex justify-between"><dt className="text-gray-500">{t('deposit')}</dt><dd className={cn('font-mono', u.lease.depositReceived ? 'text-emerald-600' : 'text-red-600')}>{fmtRate(u.lease.depositMinor, u.lease.currency)} · {u.lease.depositReceived ? t('received') : t('notReceived')}</dd></div> : null}
                  </>
                ) : (
                  <>
                    <div className="flex justify-between"><dt className="text-gray-500">{t('askingRate')}</dt><dd className="font-mono">{fmtRate(u.askingRateMinor, u.askingCurrency)}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-500">{t('listed')}</dt><dd>{u.publishedAt ? <Badge tone="blue">{t('yes')}</Badge> : <Badge tone="gray">{t('no')}</Badge>}</dd></div>
                  </>
                )}
                <div className="flex justify-between"><dt className="text-gray-500">{t('managed')}</dt><dd>{u.managedByPlatform ? <Badge tone="green" dot>{t('yes')}</Badge> : <Badge tone="gray">{t('no')}</Badge>}</dd></div>
                {u.openWorkOrders ? <div className="flex justify-between"><dt className="text-gray-500">{t('openRequests')}</dt><dd className="font-mono text-amber-600">{u.openWorkOrders}</dd></div> : null}
              </dl>
            </Card>
          ))}
          {p.units.length === 0 ? <EmptyState text={t('noUnits')} /> : null}
        </div>
      </section>

      {p.mall && p.mall.length ? (
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><Store className="h-3.5 w-3.5" />{t('mall')}</h2>
          <Card>
            <p className="text-xs text-gray-500">{t('mallHint')}</p>
            <div className="mt-2 overflow-x-auto">
              <Table>
                <thead><tr><Th>{t('unit')}</Th><Th>{t('mallTenant')}</Th><Th className="text-right">{t('mallRate')}</Th><Th>{t('mallLeaseEnd')}</Th><Th className="text-right">{t('mallCollected')}</Th><Th className="text-right">{t('mallOutstanding')}</Th><Th>{t('mallMandate')}</Th></tr></thead>
                <tbody>
                  {p.mall.map((u) => (
                    <tr key={u.id}>
                      <Td><span className="font-mono font-semibold">{u.unitNo}</span><span className="ml-2 text-xs text-gray-500">{u.areaM2} {t('sqm')}</span>{u.riskVacancy ? <span className="ml-2 text-[10px] text-amber-600">{u.vacantDays != null && u.color === 'RED' ? t('mallVacant', { n: u.vacantDays }) : t('mallRisk')}</span> : null}</Td>
                      <Td className="text-xs">{u.occupantName ?? '—'}{u.tenantCategory ? <span className="ml-1 text-gray-400">· {tM(`category.${u.tenantCategory}`)}</span> : null}</Td>
                      <Td className="text-right font-mono text-xs">{u.rentMinor != null ? `${fmtRate(u.rentMinor, u.currency)} · ${fmtRate(u.ratePerM2Minor, u.currency)}${t('mallPerM2')}` : '—'}</Td>
                      <Td className="font-mono text-xs">{u.leaseEndAt ? fmtDate(u.leaseEndAt) : '—'}</Td>
                      <Td className="text-right font-mono text-xs text-emerald-600">{fmtRate(u.collectedMinor, u.currency)}</Td>
                      <Td className={cn('text-right font-mono text-xs', u.outstandingMinor > 0n ? 'text-red-600' : 'text-gray-400')}>{fmtRate(u.outstandingMinor, u.currency)}</Td>
                      <Td className="text-xs">{u.mandate ? <span><Badge tone={u.mandate.status === 'ACTIVE' ? 'green' : u.mandate.status === 'SIGNED' ? 'yellow' : 'gray'} dot>{t(`mandateStatus.${u.mandate.status}`)}</Badge><span className="ml-1 text-[10px] text-gray-500">{u.mandate.feeBp != null ? t('mallFee', { pct: u.mandate.feeBp / 100 }) : t('mallFeeOpen')}</span></span> : <span className="text-gray-400">{t('mallNoMandate')}</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Выписка */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><Wallet className="h-3.5 w-3.5" />{t('statement')}</h2>
          <Card>
            <p className="text-xs text-gray-500">{t('statementHint', { fee: p.feeBp / 100 })}</p>
            {p.statement.length === 0 ? <p className="mt-2 text-sm text-gray-400">{t('noStatement')}</p> : (
              <div className="mt-2 overflow-x-auto">
                <Table>
                  <thead><tr><Th>{t('unit')}</Th><Th className="text-right">{t('rent')}</Th><Th className="text-right">{t('receivedCol')}</Th><Th className="text-right">{t('fee')}</Th><Th className="text-right">{t('payout')}</Th></tr></thead>
                  <tbody>
                    {p.statement.map((l) => (<tr key={l.unitNo}><Td className="font-mono font-semibold">{l.unitNo}</Td><Td className="text-right font-mono">{fmtRate(l.rentMinor, l.currency)}</Td><Td className="text-right font-mono text-xs"><span className={cn(l.chargeStatus === 'PAID' ? 'text-emerald-600' : l.chargeStatus === 'OVERDUE' ? 'text-red-600' : 'text-gray-500')}>{l.receivedMinor != null ? fmtRate(l.receivedMinor, l.currency) : '—'}</span><span className="ml-1 text-[10px] text-gray-400">{t(`chargeStatus.${(l.chargeStatus ?? 'none') as 'none'}`)}</span></Td><Td className="text-right font-mono text-gray-500">{l.managed ? `−${fmtRate(l.feeMinor, l.currency)}` : '—'}</Td><Td className="text-right font-mono font-semibold text-emerald-600">{fmtRate(l.payoutMinor, l.currency)}</Td></tr>))}
                    <tr><Td className="font-semibold">{t('total')}</Td><Td className="text-right font-mono">{fmtRate(p.totals.rent, 'USD')}</Td><Td /><Td className="text-right font-mono text-gray-500">−{fmtRate(p.totals.fee, 'USD')}</Td><Td className="text-right font-mono font-bold text-emerald-600">{fmtRate(p.totals.payout, 'USD')}</Td></tr>
                  </tbody>
                </Table>
              </div>
            )}
            <p className="mt-2 text-[11px] text-gray-400">{t('documentsCount', { n: p.documents.length })}</p>
          </Card>
        </section>

        {/* Согласия */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><ShieldCheck className="h-3.5 w-3.5" />{t('consents')}</h2>
          <Card>
            <form action={updateOwnerConsentsAction} className="space-y-2 text-sm text-gray-800">
              <label className="flex items-start gap-2"><input type="checkbox" name="managementConsent" defaultChecked={p.owner.managementConsent} className="mt-0.5 h-4 w-4" /><span><span className="font-medium">{t('consent.management')}</span><span className="block text-xs text-gray-500">{t('consent.managementHint')}</span></span></label>
              <label className="flex items-start gap-2"><input type="checkbox" name="listingConsent" defaultChecked={p.owner.listingConsent} className="mt-0.5 h-4 w-4" /><span><span className="font-medium">{t('consent.listing')}</span><span className="block text-xs text-gray-500">{t('consent.listingHint')}</span></span></label>
              <label className="flex items-start gap-2"><input type="checkbox" name="marketingConsent" defaultChecked={p.owner.marketingConsent} className="mt-0.5 h-4 w-4" /><span><span className="font-medium">{t('consent.marketing')}</span><span className="block text-xs text-gray-500">{t('consent.marketingHint')}</span></span></label>
              <div className="flex items-center gap-3 pt-1"><Button type="submit" size="sm">{t('saveConsents')}</Button>{p.owner.consentUpdatedAt ? <span className="text-xs text-gray-400">{t('consentUpdated', { d: fmtDate(p.owner.consentUpdatedAt) })}</span> : null}</div>
              <p className="text-[11px] text-gray-400">{t('consentAudit')}</p>
            </form>
          </Card>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Документы (blueprint §13) */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><FileText className="h-3.5 w-3.5" />{t('documents')}</h2>
          <Card>
            <p className="text-xs text-gray-500">{t('documentsHint')}</p>
            {docObjects.length ? (
              <form action={uploadOwnerDocumentAction} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.6fr_auto]">
                <div><Label htmlFor="d-obj">{t('docObject')}</Label><Select id="d-obj" name="object" required>{docObjects.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}</Select></div>
                <div><Label htmlFor="d-type">{t('docType')}</Label><Select id="d-type" name="docType" defaultValue="OTHER">{OWNER_DOC_TYPES.map((x) => (<option key={x} value={x}>{t(`docTypes.${x}`)}</option>))}</Select></div>
                <div><Label htmlFor="d-file">{t('docFile')}</Label><Input id="d-file" type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp,.doc,.docx" required /></div>
                <div className="self-end"><Button type="submit" size="sm" variant="outline">{t('uploadDoc')}</Button></div>
              </form>
            ) : null}
            <ul className="mt-3 divide-y divide-gray-100">
              {docs.length === 0 ? <li className="py-2 text-sm text-gray-400">{t('noDocuments')}</li> : null}
              {docs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0"><span className="font-mono text-xs font-semibold">{d.unitNo}</span><span className="ml-2 inline-block"><Badge tone="gray">{t.has(`docTypes.${d.docType}`) ? t(`docTypes.${d.docType as never}`) : d.docType}</Badge></span><span className="ml-2 truncate text-gray-900">{d.fileName}</span><span className="ml-2 text-xs text-gray-400">v{d.version} · {d.mine ? t('byYou') : t('byCompany')} · {fmtDate(d.createdAt)}</span></div>
                  {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"><Download className="h-3.5 w-3.5" />{t('download')}</a> : null}
                </li>
              ))}
            </ul>
          </Card>
        </section>

        {/* Услуги (blueprint §10/§12) */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><Sparkles className="h-3.5 w-3.5" />{t('services')}</h2>
          <Card>
            <p className="text-xs text-gray-500">{t('servicesHint')}</p>
            {p.catalog.length === 0 ? <p className="mt-2 text-sm text-gray-400">{t('noServices')}</p> : p.units.length ? (
              <form action={createOwnerServiceOrderAction} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1.2fr_auto]">
                <div><Label htmlFor="s-item">{t('service')}</Label><Select id="s-item" name="catalogItemId" required>{p.catalog.map((c) => (<option key={c.id} value={c.id}>{c.name} · {fmtRate(c.priceMinor, c.currency)} · {c.partnerName ? t('partner', { name: c.partnerName }) : t('ownOps')} · {t('slaHours', { h: c.slaHours })}</option>))}</Select></div>
                <div><Label htmlFor="s-unit">{t('unit')}</Label><Select id="s-unit" name="unitId" required>{p.units.map((u) => (<option key={u.id} value={u.id}>{u.unitNo}</option>))}</Select></div>
                <div><Label htmlFor="s-when">{t('when')}</Label><Input id="s-when" name="scheduledAt" type="datetime-local" /></div>
                <div className="self-end"><Button type="submit" size="sm">{t('orderService')}</Button></div>
              </form>
            ) : null}
            <ul className="mt-3 divide-y divide-gray-100">
              {p.serviceOrders.length === 0 ? <li className="py-2 text-sm text-gray-400">{t('noOrders')}</li> : null}
              {p.serviceOrders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div><span className="font-mono text-xs text-gray-400">{o.number}</span><span className="ml-2 font-mono font-semibold">{o.unitNo}</span><span className="ml-2 text-gray-900">{o.serviceName}</span><span className="ml-2 font-mono text-xs text-gray-500">{fmtRate(o.priceMinor, o.currency)}</span></div>
                  <div className="flex items-center gap-2">
                    <Badge tone={SO_TONE[o.status]} dot>{ts(`status.${o.status}`)}</Badge>
                    {o.rating != null ? <span className="inline-flex items-center gap-0.5 text-xs text-amber-600"><Star className="h-3 w-3" />{t('rated', { r: o.rating })}</span> : null}
                    {o.canRate ? <form action={rateOwnerServiceOrderAction} className="flex items-center gap-1"><input type="hidden" name="id" value={o.id} /><Select name="rating" defaultValue="5" aria-label={t('rate')} className="h-8 py-0 text-xs">{[5, 4, 3, 2, 1].map((n) => (<option key={n} value={n}>{'★'.repeat(n)}</option>))}</Select><Button type="submit" size="sm" variant="outline">{t('rate')}</Button></form> : null}
                    <span className="font-mono text-xs text-gray-400">{fmtDate(o.scheduledAt)}{o.doneAt ? ` → ${fmtDate(o.doneAt)}` : ''}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>

      {/* Заявки */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><Wrench className="h-3.5 w-3.5" />{t('requests')}</h2>
        <Card>
          {p.units.length ? (
            <form action={createOwnerRequestAction} className="grid gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
              <div><Label htmlFor="o-unit">{t('unit')}</Label><Select id="o-unit" name="unitId" required>{p.units.map((u) => (<option key={u.id} value={u.id}>{u.unitNo}</option>))}</Select></div>
              <div><Label htmlFor="o-cat">{tw('fields.category')}</Label><Select id="o-cat" name="category" defaultValue="OTHER">{WORK_ORDER_CATEGORIES.map((c) => (<option key={c} value={c}>{tw(`category.${c}`)}</option>))}</Select></div>
              <div><Label htmlFor="o-title">{t('requestTitle')}</Label><Input id="o-title" name="title" required placeholder={t('requestPlaceholder')} /></div>
              <div className="self-end"><Button type="submit" size="sm">{t('sendRequest')}</Button></div>
            </form>
          ) : null}
          <ul className="mt-3 divide-y divide-gray-100">
            {p.requests.length === 0 ? <li className="py-2 text-sm text-gray-400">{t('noRequests')}</li> : null}
            {p.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div><span className="font-mono text-xs text-gray-400">{r.number}</span><span className="ml-2 font-mono font-semibold">{r.unitNo}</span><span className="ml-2 text-gray-900">{r.title}</span></div>
                <div className="flex items-center gap-2"><Badge tone={WO_TONE[r.status]} dot>{tw(`status.${r.status}`)}</Badge><span className="font-mono text-xs text-gray-400">{fmtDate(r.createdAt)}{r.doneAt ? ` → ${fmtDate(r.doneAt)}` : ''}</span></div>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-gray-400"><FileSignature className="h-3 w-3" />{t('requestsHint')}</p>
        </Card>
      </section>
    </div>
  );
}
