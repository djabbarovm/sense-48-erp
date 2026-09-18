import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Building2, FileSignature, ShieldCheck, Wallet, Wrench } from 'lucide-react';
import { NotFoundError, WORK_ORDER_CATEGORIES, can } from '@finance-os/core';
import { getOwnerPortal } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Table, Td, Th, cn } from '@/components/ui';
import { COLOR_BG, fmtDate, fmtRate } from '@/components/property';
import { createOwnerRequestAction, updateOwnerConsentsAction } from './actions';

/* Wave 4b — Owner Portal (blueprint §10): только свои юниты, договоры, выплаты, заявки, согласия. */

const WO_TONE = { OPEN: 'red', ASSIGNED: 'yellow', IN_PROGRESS: 'blue', DONE: 'green', VERIFIED: 'green', CANCELLED: 'gray' } as const;

export default async function OwnerPortalPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'owner.portal')) notFound();
  const { error } = await searchParams;
  const t = await getTranslations('ownerPortal');
  const tp = await getTranslations('property');
  const tw = await getTranslations('workorders');
  let p: Awaited<ReturnType<typeof getOwnerPortal>>;
  try {
    p = await getOwnerPortal(ctx);
  } catch (e) {
    if (e instanceof NotFoundError) return <div className="space-y-4"><PageHeader title={t('title')} /><EmptyState icon={<ShieldCheck />} text={t('notLinked')} /></div>;
    throw e;
  }

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

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Выписка */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase"><Wallet className="h-3.5 w-3.5" />{t('statement')}</h2>
          <Card>
            <p className="text-xs text-gray-500">{t('statementHint', { fee: p.feeBp / 100 })}</p>
            {p.statement.length === 0 ? <p className="mt-2 text-sm text-gray-400">{t('noStatement')}</p> : (
              <div className="mt-2 overflow-x-auto">
                <Table>
                  <thead><tr><Th>{t('unit')}</Th><Th className="text-right">{t('rent')}</Th><Th className="text-right">{t('fee')}</Th><Th className="text-right">{t('payout')}</Th></tr></thead>
                  <tbody>
                    {p.statement.map((l) => (<tr key={l.unitNo}><Td className="font-mono font-semibold">{l.unitNo}</Td><Td className="text-right font-mono">{fmtRate(l.rentMinor, l.currency)}</Td><Td className="text-right font-mono text-gray-500">{l.managed ? `−${fmtRate(l.feeMinor, l.currency)}` : '—'}</Td><Td className="text-right font-mono font-semibold text-emerald-600">{fmtRate(l.payoutMinor, l.currency)}</Td></tr>))}
                    <tr><Td className="font-semibold">{t('total')}</Td><Td className="text-right font-mono">{fmtRate(p.totals.rent, 'USD')}</Td><Td className="text-right font-mono text-gray-500">−{fmtRate(p.totals.fee, 'USD')}</Td><Td className="text-right font-mono font-bold text-emerald-600">{fmtRate(p.totals.payout, 'USD')}</Td></tr>
                  </tbody>
                </Table>
              </div>
            )}
            <p className="mt-2 text-[11px] text-gray-400">{t('documentsCount', { n: p.documents })}</p>
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
