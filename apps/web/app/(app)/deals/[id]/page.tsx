import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, ArrowLeft, ArrowRight, BadgePercent, Building2, CheckCircle2, Circle, MessageSquare, RotateCcw, XCircle } from 'lucide-react';
import { DEAL_LOST_REASONS, DEAL_PRODUCTS, DEAL_SOURCES, LEASE_TYPES, NotFoundError, SALE_PRODUCTS, TENANT_CATEGORIES, can } from '@finance-os/core';
import { getDeal, getDealCommission, listDealManagers, listUnits } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, PageHeader, Select } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';
import { addDealActivityAction, checklistAction, closeSaleAction, confirmKpiAction, createLeaseFromDealAction, moveDealAction, updateDealAction } from '../actions';
import { BONUS_TONE, COMMISSION_TONE } from '../../commissions/tones';

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3 text-[13px]"><dt className="text-gray-500">{k}</dt><dd className="text-right font-medium text-gray-900">{v}</dd></div>;
}

export default async function DealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'deal.view')) notFound();
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getTranslations('deals');
  let data: Awaited<ReturnType<typeof getDeal>>;
  try {
    data = await getDeal(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { deal, managerName, probability, attention, nextStage, prevStage, can: c, lease, audit } = data;
  const [managers, units] = c.edit ? await Promise.all([listDealManagers(ctx), listUnits(ctx)]) : [[], []];
  const cm = await getDealCommission(ctx, id);
  const isSale = SALE_PRODUCTS.includes(deal.product);
  const selectable = units.filter((u) => u.view.isSellable || u.id === deal.unitId);
  const usd = (m: bigint | null | undefined) => (m == null ? '' : (Number(m) / 100).toFixed(2));
  const dt = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '');
  const closed = deal.stage === 'WON' || deal.stage === 'LOST';

  return (
    <div className="space-y-5">
      <PageHeader
        title={<span className="font-mono">{deal.number}</span>}
        meta={<span className="flex flex-wrap items-center gap-2"><Badge tone={deal.stage === 'WON' ? 'green' : deal.stage === 'LOST' ? 'red' : 'blue'} dot>{t(`stage.${deal.stage}`)} · {probability}%</Badge>{attention.map((a) => (<Badge key={a} tone="red">{t(`attentionKind.${a}`)}</Badge>))}</span>}
        actions={<Link href="/deals" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"><ArrowLeft className="h-4 w-4" />{t('toBoard')}</Link>}
      />
      {error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${error}`) ? t(`error.${error}`) : t('error.GENERIC')}</div> : null}

      {/* Стадии — кнопки переходов */}
      {c.edit && (!closed || c.reopen) ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            {c.back && prevStage ? <form action={moveDealAction}><input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="trigger" value="back" /><Button type="submit" variant="outline" size="sm"><ArrowLeft className="h-3.5 w-3.5" />{t(`stage.${prevStage}`)}</Button></form> : null}
            {c.advance && nextStage ? <form action={moveDealAction}><input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="trigger" value="advance" /><Button type="submit" size="sm">{t(`stage.${nextStage}`)}<ArrowRight className="h-3.5 w-3.5" /></Button></form> : null}
            {!c.advance && nextStage && !closed ? <span className="text-xs text-gray-500">{deal.unitId ? t('advanceBlockedBroker') : t('advanceNeedsUnit')}</span> : null}
            {c.reopen ? <form action={moveDealAction}><input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="trigger" value="reopen" /><Button type="submit" variant="outline" size="sm"><RotateCcw className="h-3.5 w-3.5" />{t('reopen')}</Button></form> : null}
            {c.lose ? (
              <form action={moveDealAction} className="ml-auto flex flex-wrap items-center gap-2">
                <input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="trigger" value="lose" />
                <Select name="lostReason" required aria-label={t('lostReason')} className="w-44"><option value="">{t('lostReason')}</option>{DEAL_LOST_REASONS.map((r) => (<option key={r} value={r}>{t(`lost.${r}`)}</option>))}</Select>
                <Input name="lostNote" placeholder={t('lostNote')} className="w-52" aria-label={t('lostNote')} />
                <Button type="submit" variant="danger" size="sm"><XCircle className="h-3.5 w-3.5" />{t('markLost')}</Button>
              </form>
            ) : null}
          </div>
          {deal.stage === 'CONTRACT' || deal.stage === 'MOVE_IN' ? <p className="mt-2 text-xs text-gray-500">{t('winHint')}</p> : null}
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="font-display text-sm font-semibold">{t('client')}</h3>
          <dl className="mt-3 space-y-1.5">
            <Row k={t('contactName')} v={deal.contactId ? <Link href={`/contacts/${deal.contactId}`} className="text-brand-600 hover:underline">{deal.contactName}</Link> : deal.contactName} />
            <Row k={t('company')} v={deal.company ?? '—'} />
            <Row k={t('phone')} v={deal.contactPhone ?? <span className="text-gray-400">{can(ctx, 'deal.contact.view') ? '—' : t('hidden')}</span>} />
            <Row k={t('email')} v={deal.contactEmail ?? '—'} />
            <Row k={t('sourceLabel')} v={t(`source.${deal.source}`)} />
            <Row k={t('manager')} v={managerName} />
            <Row k={t('created')} v={fmtDate(deal.createdAt)} />
          </dl>
          <h3 className="mt-5 font-display text-sm font-semibold">{t('demand')}</h3>
          <dl className="mt-3 space-y-1.5">
            <Row k={t('budgetUsd')} v={fmtRate(deal.budgetMinor, 'USD')} />
            <Row k={t('area')} v={deal.areaMinM2 || deal.areaMaxM2 ? `${deal.areaMinM2 ?? '…'} – ${deal.areaMaxM2 ?? '…'} м²` : '—'} />
            <Row k={t('purpose')} v={deal.purpose ?? '—'} />
            <Row k={t('timing')} v={deal.timing ?? '—'} />
          </dl>
        </Card>

        <Card>
          <h3 className="font-display text-sm font-semibold">{t('unitAndTerms')}</h3>
          {deal.unit ? (
            <dl className="mt-3 space-y-1.5">
              <Row k={t('unit')} v={<Link href={`/property/units/${deal.unit.id}`} className="font-mono font-semibold text-brand-600 hover:underline">{deal.unit.unitNo}</Link>} />
              <Row k={t('building')} v={`${deal.unit.building.name} · ${deal.unit.floor.floorNo}`} />
              <Row k={t('area')} v={`${deal.unit.areaM2} м²`} />
              <Row k={t('askingRate')} v={fmtRate(deal.unit.askingRateMinor, deal.unit.askingCurrency)} />
            </dl>
          ) : <p className="mt-2 text-sm text-gray-400">{t('noUnitYet')}</p>}
          <dl className="mt-3 space-y-1.5">
            <Row k={t('productLabel')} v={t(`product.${deal.product}`)} />
            {isSale ? <Row k={t('salePriceUsd')} v={fmtRate(deal.salePriceMinor ?? deal.unit?.askingRateMinor ?? null, 'USD')} /> : <Row k={t('expectedRateUsd')} v={fmtRate(deal.expectedRateMinor, 'USD')} />}
            {deal.externalBrokerName ? <Row k={t('externalBroker')} v={`${deal.externalBrokerName} · ${deal.externalShareBp / 100}%`} /> : null}
            <Row k={t('reservedUntil')} v={fmtDate(deal.reservedUntil)} />
            <Row k={t('depositReceived')} v={deal.depositReceived ? t('yes') : t('no')} />
            <Row k={t('nextAction')} v={deal.nextAction ? `${fmtDate(deal.nextActionAt)} · ${deal.nextAction}` : '—'} />
            <Row k={t('stageSince')} v={fmtDate(deal.stageChangedAt)} />
            {deal.lostReason ? <Row k={t('lostReason')} v={`${t(`lost.${deal.lostReason}`)}${deal.lostNote ? ` · ${deal.lostNote}` : ''}`} /> : null}
            {lease ? <Row k={t('lease')} v={<Link href={`/property/units/${deal.unitId}`} className="text-brand-600 hover:underline">{t(`leaseStatus.${lease.status}`)}</Link>} /> : null}
          </dl>
          {c.lease && deal.unit ? (
            <form action={createLeaseFromDealAction} className="mt-4 space-y-2 border-t border-gray-100 pt-3">
              <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-800"><Building2 className="h-3.5 w-3.5" />{t('leaseFromDeal')}</h4>
              <input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="unitId" value={deal.unit.id} />
              <input type="hidden" name="occupantName" value={deal.company ?? deal.contactName} /><input type="hidden" name="occupantContact" value={deal.contactPhone ?? ''} />
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="l-type">{t('leaseType')}</Label><Select id="l-type" name="type" defaultValue="LTR">{LEASE_TYPES.map((x) => (<option key={x} value={x}>{t(`leaseType.${x}`)}</option>))}</Select></div>
                <div><Label htmlFor="l-rent">{t('rentUsd')}</Label><Input id="l-rent" name="rent" type="number" min="0" step="0.01" defaultValue={usd(deal.expectedRateMinor ?? deal.unit.askingRateMinor)} required /></div>
                <div><Label htmlFor="l-start">{t('startAt')}</Label><Input id="l-start" name="startAt" type="date" required /></div>
                <div><Label htmlFor="l-end">{t('endAt')}</Label><Input id="l-end" name="endAt" type="date" /></div>
                <div><Label htmlFor="l-dep">{t('depositUsd')}</Label><Input id="l-dep" name="deposit" type="number" min="0" step="0.01" /></div>
                {deal.product === 'MALL_LEASE' ? <div><Label htmlFor="l-cat">{t('tenantCategory')}</Label><Select id="l-cat" name="tenantCategory" defaultValue={deal.tenantCategory ?? 'OTHER'}>{TENANT_CATEGORIES.map((c) => (<option key={c} value={c}>{t(`category.${c}`)}</option>))}</Select></div> : null}
                <div className="flex flex-col justify-end gap-1 text-xs text-gray-700">
                  <label className="flex items-center gap-2"><input type="checkbox" name="depositReceived" className="h-4 w-4" />{t('depositReceived')}</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="activate" defaultChecked className="h-4 w-4" />{t('activateNow')}</label>
                </div>
              </div>
              <Button type="submit" size="sm">{t('createLease')}</Button>
              <p className="text-[11px] text-gray-400">{t('leaseHint')}</p>
            </form>
          ) : null}
          {c.closeSale ? (
            <form action={closeSaleAction} className="mt-4 space-y-2 border-t border-gray-100 pt-3">
              <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-800"><BadgePercent className="h-3.5 w-3.5" />{t('closeSale')}</h4>
              <input type="hidden" name="dealId" value={deal.id} />
              <div className="flex items-end gap-2"><div className="flex-1"><Label htmlFor="s-price">{t('salePriceUsd')}</Label><Input id="s-price" name="salePrice" type="number" min="0" step="0.01" defaultValue={usd(deal.salePriceMinor)} required /></div><Button type="submit" size="sm">{t('closeSale')}</Button></div>
              <p className="text-[11px] text-gray-400">{t('closeSaleHint')}</p>
            </form>
          ) : null}
        </Card>

        <Card>
          <h3 className="font-display text-sm font-semibold">{t('edit')}</h3>
          {c.edit && !closed ? (
            <form action={updateDealAction} className="mt-3 space-y-2">
              <input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="depositReceivedFlag" value="1" />
              <div><Label htmlFor="e-unit">{t('unit')}</Label><Select id="e-unit" name="unitId" defaultValue={deal.unitId ?? ''}><option value="">{t('noUnitYet')}</option>{selectable.map((u) => (<option key={u.id} value={u.id}>{u.unitNo} · {u.areaM2} {t('sqm')}</option>))}</Select></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="e-rate">{t('expectedRateUsd')}</Label><Input id="e-rate" name="expectedRate" type="number" min="0" step="0.01" defaultValue={usd(deal.expectedRateMinor)} /></div>
                <div><Label htmlFor="e-res">{t('reservedUntil')}</Label><Input id="e-res" name="reservedUntil" type="date" defaultValue={dt(deal.reservedUntil)} /></div>
                <div><Label htmlFor="e-next">{t('nextAction')}</Label><Input id="e-next" name="nextAction" defaultValue={deal.nextAction ?? ''} /></div>
                <div><Label htmlFor="e-nextAt">{t('nextActionAt')}</Label><Input id="e-nextAt" name="nextActionAt" type="date" defaultValue={dt(deal.nextActionAt)} /></div>
                <div><Label htmlFor="e-product">{t('productLabel')}</Label><Select id="e-product" name="product" defaultValue={deal.product}>{DEAL_PRODUCTS.map((p) => (<option key={p} value={p}>{t(`product.${p}`)}</option>))}</Select></div>
                <div><Label htmlFor="e-cat">{t('tenantCategory')}</Label><Select id="e-cat" name="tenantCategory" defaultValue={deal.tenantCategory ?? ''}><option value="">—</option>{TENANT_CATEGORIES.map((c) => (<option key={c} value={c}>{t(`category.${c}`)}</option>))}</Select></div>
                <div><Label htmlFor="e-sale">{t('salePriceUsd')}</Label><Input id="e-sale" name="salePrice" type="number" min="0" step="0.01" defaultValue={usd(deal.salePriceMinor)} /></div>
                <div><Label htmlFor="e-crate">{t('commissionRatePct')}</Label><Input id="e-crate" name="commissionRatePct" type="number" min="0" max="100" step="0.1" defaultValue={deal.commissionRateBp != null ? (deal.commissionRateBp / 100).toString() : ''} placeholder={t('commissionRateHint')} /></div>
                <div><Label htmlFor="e-broker">{t('externalBroker')}</Label><Input id="e-broker" name="externalBrokerName" defaultValue={deal.externalBrokerName ?? ''} /></div>
                <div><Label htmlFor="e-share">{t('externalSharePct')}</Label><Input id="e-share" name="externalSharePct" type="number" min="0" max="100" step="0.5" defaultValue={deal.externalShareBp ? (deal.externalShareBp / 100).toString() : ''} /></div>
                <div><Label htmlFor="e-source">{t('sourceLabel')}</Label><Select id="e-source" name="source" defaultValue={deal.source}>{DEAL_SOURCES.map((s) => (<option key={s} value={s}>{t(`source.${s}`)}</option>))}</Select></div>
                {managers.length && !(ctx.roles.includes('BROKER') && !ctx.roles.some((r) => r === 'OWNER' || r === 'COMMERCIAL_MANAGER')) ? <div><Label htmlFor="e-manager">{t('manager')}</Label><Select id="e-manager" name="managerId" defaultValue={deal.managerId}>{managers.map((m) => (<option key={m.id} value={m.id}>{m.fullName}</option>))}</Select></div> : null}
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-700"><input type="checkbox" name="depositReceived" defaultChecked={deal.depositReceived} className="h-4 w-4" />{t('depositReceived')}</label>
              <Button type="submit" variant="outline" size="sm">{t('save')}</Button>
            </form>
          ) : <p className="mt-2 text-sm text-gray-400">{closed ? t('closedHint') : t('readOnly')}</p>}
        </Card>
      </div>

      {cm.commission || cm.bonuses.length || cm.checklist.length || (deal.stage === 'WON' && can(ctx, 'commission.view')) ? (
        <Card>
          <div className="flex items-center gap-2"><BadgePercent className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('commissionBlock')}</h3>{cm.commission ? <Badge tone={COMMISSION_TONE[cm.commission.status]} dot>{t(`commissionStatus.${cm.commission.status}`)}</Badge> : null}</div>
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <div>
              {cm.commission ? (
                <dl className="space-y-1.5">
                  <Row k={t('commissionPayer')} v={`${cm.commission.payerName} (${t(`payer.${cm.commission.payer}`)})`} />
                  <Row k={t('commissionAmount')} v={<span className="font-mono">{fmtRate(cm.commission.amountMinor, cm.commission.currency)} · {cm.commission.rateBp / 100}%</span>} />
                  {cm.commission.netMinor !== cm.commission.amountMinor ? <Row k={t('commissionNet')} v={<span className="font-mono">{fmtRate(cm.commission.netMinor, cm.commission.currency)}</span>} /> : null}
                  <Row k={t('commissionReceived')} v={<span className="font-mono text-emerald-600">{fmtRate(cm.commission.receivedMinor, cm.commission.currency)}</span>} />
                  <Row k={t('commissionDue')} v={fmtDate(cm.commission.dueAt)} />
                  {cm.commission.cancelReason ? <Row k={t('lostReason')} v={cm.commission.cancelReason} /> : null}
                </dl>
              ) : <p className="text-sm text-gray-400">{deal.stage === 'WON' ? t('commissionOpen') : t('commissionNone')}</p>}
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{t('bonusTitle')}</p>
              <ul className="mt-1 divide-y divide-gray-100">
                {cm.bonuses.length === 0 ? <li className="py-1.5 text-xs text-gray-400">—</li> : null}
                {cm.bonuses.map((b) => (<li key={b.id} className="flex items-center justify-between gap-2 py-1.5 text-xs"><span>{t(`bonusKind.${b.kind}`)} · {b.rateBp / 100}% · <span className="text-gray-500">{b.employeeName}</span></span><span className="flex items-center gap-2"><span className={b.status === 'WITHHELD' ? 'font-mono text-gray-400 line-through' : 'font-mono'}>{fmtRate(b.amountMinor, b.currency)}</span><Badge tone={BONUS_TONE[b.status]}>{t(`bonusStatus.${b.status}`)}</Badge></span></li>))}
              </ul>
              <p className="mt-1 text-[11px] text-gray-400">{t('bonusHint')}</p>
            </div>
            <div>
              {cm.checklist.length ? (
                <>
                  <p className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{t('checklist')}{cm.kpi?.deadline ? <span className="ml-2 font-normal normal-case">{cm.kpi.confirmedAt ? t('checklistConfirmed', { d: fmtDate(cm.kpi.confirmedAt) }) : t('checklistDeadline', { d: fmtDate(cm.kpi.deadline) })}</span> : null}</p>
                  <ul className="mt-1 divide-y divide-gray-100">
                    {cm.checklist.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                        <span className="flex items-center gap-1.5">{i.doneAt ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Circle className="h-3.5 w-3.5 text-gray-300" />}<span className={i.doneAt ? 'text-gray-900' : 'text-gray-600'}>{t(`checklistItem.${i.item}`)}</span>{i.doneAt ? <span className="text-[10px] text-gray-400">{t('doneBy', { name: i.doneByName ?? '', d: fmtDate(i.doneAt) })}</span> : null}</span>
                        {cm.can.checklist ? <form action={checklistAction}><input type="hidden" name="dealId" value={deal.id} /><input type="hidden" name="item" value={i.item} /><input type="hidden" name="done" value={i.doneAt ? '0' : '1'} /><Button type="submit" size="sm" variant="outline">{i.doneAt ? t('markUndone') : t('markDone')}</Button></form> : null}
                      </li>
                    ))}
                  </ul>
                  {cm.can.confirmKpi ? <form action={confirmKpiAction} className="mt-2 flex items-center gap-2"><input type="hidden" name="dealId" value={deal.id} /><Button type="submit" size="sm">{t('confirmKpi')}</Button><span className="text-[11px] text-gray-400">{t('confirmKpiHint')}</span></form> : null}
                </>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('activities')}</h3></div>
          {c.edit ? (
            <form action={addDealActivityAction} className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_1fr_1fr_auto]">
              <input type="hidden" name="dealId" value={deal.id} />
              <Select name="kind" defaultValue="CALL" aria-label={t('activityKind')}>{(['VIEWING', 'CALL', 'NOTE', 'FOLLOW_UP', 'OFFER'] as const).map((k) => (<option key={k} value={k}>{t(`activity.${k}`)}</option>))}</Select>
              <Input name="note" placeholder={t('activityPlaceholder')} required aria-label={t('note')} />
              <Input name="expectedRate" type="number" min="0" step="0.01" placeholder={t('expectedRateUsd')} aria-label={t('expectedRateUsd')} />
              <Input name="followUpAt" type="date" aria-label={t('followUp')} />
              <Button type="submit" size="sm">{t('add')}</Button>
            </form>
          ) : null}
          <ul className="mt-3 divide-y divide-gray-100">
            {deal.activities.length === 0 ? <li className="py-2 text-sm text-gray-400">{t('noActivities')}</li> : null}
            {deal.activities.map((a) => (
              <li key={a.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-2"><span className="font-medium text-gray-900">{t(`activity.${a.kind}`)}</span><span className="font-mono text-xs text-gray-400">{fmtDate(a.happenedAt)}</span></div>
                <p className="text-gray-700">{a.note}</p>
                {a.followUpAt ? <p className="text-xs text-gray-500">{t('followUp')}: {fmtDate(a.followUpAt)}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h3 className="font-display text-sm font-semibold">{t('history')}</h3>
          <ul className="mt-3 divide-y divide-gray-100">
            {audit.length === 0 ? <li className="py-2 text-sm text-gray-400">—</li> : null}
            {audit.map((a) => {
              const af = (a.after ?? {}) as Record<string, unknown>;
              const b = (a.before ?? {}) as Record<string, unknown>;
              return <li key={a.id} className="py-2 text-xs"><div className="flex justify-between gap-2"><span className="font-mono font-semibold text-gray-800">{a.action}</span><span className="font-mono text-gray-400">{new Date(a.at).toLocaleString('ru-RU')}</span></div>{typeof af.stage === 'string' ? <p className="text-gray-600">{typeof b.stage === 'string' ? `${t(`stage.${b.stage as never}`)} → ` : ''}{t(`stage.${af.stage as never}`)}</p> : null}</li>;
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
}
