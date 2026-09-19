import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, ArrowLeft, Building2, Calculator, Clock, FileSignature, History, Handshake, MessageSquare } from 'lucide-react';
import { NotFoundError, OWNER_LOST_REASONS, OWNER_STAGES, canMoveOwnerStage } from '@finance-os/core';
import { getOwnerCard, listDealManagers, ownerCalc } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, PageHeader, Select, cn } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';
import { CONTRACT_TONE } from '../../../house/tones';
import { OWNER_STAGE_TONE } from '../tones';
import { addOwnerActivityAction, markCalcShownAction, moveOwnerStageAction, setOwnerNextActionAction } from '../actions';
import { setManagementContractStatusAction } from '../../../house/actions';

/* CRM Tower — карточка собственника (docs/20 §11.15): стадия воронки, помещения, контакты, расчёт STR / mid-term / LTR, следующее действие, история. */

const ACTIVITY_KINDS = ['CALL', 'NOTE', 'VIEWING', 'FOLLOW_UP', 'OFFER'] as const;
function Row({ k, v }: { k: string; v: React.ReactNode }) { return (<div className="flex items-start justify-between gap-3 text-sm"><dt className="text-gray-500">{k}</dt><dd className="text-right text-gray-900">{v}</dd></div>); }

export default async function OwnerCardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; adr?: string; occ?: string; ltr?: string; fee?: string; unit?: string }> }) {
  const ctx = await requireTenantContext();
  const { id } = await params; const sp = await searchParams;
  const t = await getTranslations('owners'); const tD = await getTranslations('deals'); const tP = await getTranslations('property');
  let data: Awaited<ReturnType<typeof getOwnerCard>>;
  try { data = await getOwnerCard(ctx, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const { owner: o, units, activities, contact } = data;
  const usd = (v: string | undefined) => (v && /^\d+(\.\d{1,2})?$/.test(v) ? BigInt(Math.round(Number(v) * 100)) : undefined);
  const calcRes = await ownerCalc(ctx, id, { ...(usd(sp.ltr) ? { ltrMonthlyMinor: usd(sp.ltr)! } : {}), ...(usd(sp.adr) ? { strAdrMinor: usd(sp.adr)! } : {}), ...(sp.occ ? { strOccupancyPct: Number(sp.occ) } : {}), ...(sp.fee ? { strFeeBp: Math.round(Number(sp.fee) * 100) } : {}), ...(sp.unit ? { unitId: sp.unit } : {}) });
  const managers = data.canManage ? await listDealManagers(ctx) : [];
  const nextStages = OWNER_STAGES.filter((s) => canMoveOwnerStage(o.stage, s));
  const summary = calcRes.calc ? calcRes.calc.scenarios.map((s) => `${s.key} ${fmtRate(s.ownerNetMonthlyMinor, calcRes.currency)}/мес`).join(' · ') : '';

  return (
    <div className="space-y-5">
      <PageHeader
        title={o.displayName}
        meta={<span className="flex flex-wrap items-center gap-2"><Badge tone={OWNER_STAGE_TONE[o.stage]} dot>{t(`stage.${o.stage}`)}</Badge><span className="font-mono text-xs text-gray-500">{o.daysInStage}{t('pipeline.d')}</span><Badge tone="gray">{t(`kind.${o.kind}`)}</Badge><Badge tone="gray">{t(`segment.${data.segment}`)}</Badge><Badge tone={CONTRACT_TONE[o.managementContractStatus]}>{t('contract.title')}: {t(`contract.${o.managementContractStatus}`)}</Badge>{o.lostReason ? <Badge tone="red">{t(`lost.${o.lostReason}`)}</Badge> : null}</span>}
        actions={<Link href="/property/owners?view=pipeline" className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200"><ArrowLeft className="h-4 w-4" />{t('pipeline.back')}</Link>}
      />
      {sp.error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : t('error.GENERIC')}</div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="font-display text-sm font-semibold">{t('card.contacts')}</h3>
          <dl className="mt-3 space-y-1.5">
            <Row k={t('card.phone')} v={<span className="font-mono">{o.contactPhone ?? '—'}</span>} />
            <Row k={t('card.email')} v={o.contactEmail ?? '—'} />
            <Row k={t('card.manager')} v={o.managerName ?? '—'} />
            <Row k={t('card.source')} v={o.source ? tD(`source.${o.source}`) : '—'} />
            <Row k={t('card.consents')} v={<span className="text-xs"><span className={o.managementConsent ? 'text-emerald-600' : 'text-gray-400'}>{t('c.management')}</span> · <span className={o.listingConsent ? 'text-emerald-600' : 'text-gray-400'}>{t('c.listing')}</span> · <span className={o.marketingConsent ? 'text-emerald-600' : 'text-gray-400'}>{t('c.marketing')}</span></span>} />
            <Row k={t('card.calcShown')} v={o.calcShownAt ? fmtDate(o.calcShownAt) : <span className="text-amber-600">{t('card.calcNotShown')}</span>} />
          </dl>
          {!data.pii ? <p className="mt-2 text-[11px] text-gray-400">{t('card.piiHidden')}</p> : null}
          {o.notes ? <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">{o.notes}</p> : null}
          {contact ? <p className="mt-3 text-xs text-gray-600"><Handshake className="mr-1 inline h-3.5 w-3.5" /><Link href={`/contacts/${contact.id}`} className="text-brand-600 hover:underline">{t('card.asClient')}</Link>{contact.deals.length ? ` · ${contact.deals.map((d) => d.number).join(', ')}` : ''}</p> : null}
          {data.canManage ? (
            <form action={setManagementContractStatusAction} className="mt-4 flex flex-wrap items-end gap-1.5 border-t border-gray-100 pt-3">
              <input type="hidden" name="ownerId" value={o.id} /><input type="hidden" name="back" value={`/property/owners/${o.id}`} />
              <div><Label htmlFor="cs">{t('contract.title')}</Label><Select id="cs" name="status" defaultValue={o.managementContractStatus} className="w-36">{(['NONE', 'SENT', 'SIGNED', 'DECLINED'] as const).map((st) => (<option key={st} value={st}>{t(`contract.${st}`)}</option>))}</Select></div>
              <div><Label htmlFor="csd">{t('contract.signedAt')}</Label><Input id="csd" name="signedAt" type="date" className="w-36" /></div>
              <Button type="submit" size="sm" variant="outline">{t('contract.set')}</Button>
            </form>
          ) : null}
        </Card>

        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Building2 className="h-4 w-4 text-brand-500" />{t('card.units')}</h3>
          <ul className="mt-3 divide-y divide-gray-100 text-sm">
            {units.map((u) => (<li key={u.id} className="flex items-center justify-between gap-2 py-1.5"><span><Link href={`/property/units/${u.id}`} className="font-mono font-semibold text-ink-900 hover:text-brand-600">{u.unitNo}</Link><span className="ml-2 text-xs text-gray-500">{tP(`type.${u.type}`)} · {u.areaM2} {tP('sqm')} · {u.building.name}</span></span><span className="text-right text-xs">{u.managedByPlatform ? <Badge tone="green">{t('card.managed')}</Badge> : <Badge tone="gray">{t('card.brokerage')}</Badge>}<span className="ml-2 font-mono text-gray-600">{fmtRate(u.monthlyRentMinor ?? u.askingRateMinor, u.askingCurrency)}</span></span></li>))}
            {units.length === 0 ? <li className="py-2 text-gray-400">{t('card.noUnits')}</li> : null}
          </ul>
          <p className="mt-2 text-[11px] text-gray-400">{t('card.managedHint')}</p>
        </Card>

        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Clock className="h-4 w-4 text-brand-500" />{t('card.next')}</h3>
          <p className={cn('mt-2 text-sm', o.overdue ? 'text-red-700' : 'text-gray-800')}>{o.nextAction ?? <span className="text-amber-600">{t('pipeline.noNextOne')}</span>}{o.nextActionAt ? <span className="ml-2 font-mono text-xs">{fmtDate(o.nextActionAt)}</span> : null}</p>
          {data.canManage ? (
            <>
              <form action={setOwnerNextActionAction} className="mt-3 grid gap-2">
                <input type="hidden" name="ownerId" value={o.id} />
                <Input name="nextAction" defaultValue={o.nextAction ?? ''} placeholder={t('card.nextPlaceholder')} aria-label={t('card.next')} />
                <div className="flex flex-wrap items-end gap-2"><Input name="nextActionAt" type="date" defaultValue={o.nextActionAt ? o.nextActionAt.toISOString().slice(0, 10) : ''} className="w-40" aria-label={t('card.nextAt')} /><Select name="managerId" defaultValue={o.managerId ?? ''} className="w-44" aria-label={t('card.manager')}><option value="">{t('card.keepManager')}</option>{managers.map((m) => (<option key={m.id} value={m.id}>{m.fullName}</option>))}</Select><Button type="submit" size="sm" variant="outline">{t('card.save')}</Button></div>
              </form>
              <form action={moveOwnerStageAction} className="mt-4 grid gap-2 border-t border-gray-100 pt-3">
                <input type="hidden" name="ownerId" value={o.id} />
                <Label htmlFor="st">{t('card.moveStage')}</Label>
                <div className="flex flex-wrap items-end gap-2">
                  <Select id="st" name="stage" className="w-48">{nextStages.map((s) => (<option key={s} value={s}>{t(`stage.${s}`)}</option>))}</Select>
                  <Select name="reason" className="w-44" aria-label={t('card.lostReason')}><option value="">{t('card.lostReason')}</option>{OWNER_LOST_REASONS.map((r) => (<option key={r} value={r}>{t(`lost.${r}`)}</option>))}</Select>
                  <Input name="note" placeholder={t('card.note')} className="w-44" />
                  <Button type="submit" size="sm">{t('card.move')}</Button>
                </div>
                <p className="text-[11px] text-gray-400">{t('card.moveHint')}</p>
              </form>
            </>
          ) : null}
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Calculator className="h-4 w-4 text-brand-500" />{t('calc.title')}</h3>
          {calcRes.calc ? <Badge tone={calcRes.calc.provisional ? 'yellow' : 'green'}>{t('calc.recommended')}: {t(`calc.${calcRes.calc.recommended}`)}{calcRes.calc.provisional ? ` · ${t('calc.provisional')}` : ''}</Badge> : null}
        </div>
        <p className="mt-1 text-xs text-gray-500">{t('calc.hint')}</p>
        <form method="get" className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <div><Label htmlFor="c-ltr">{t('calc.ltrRent')}</Label><Input id="c-ltr" name="ltr" type="number" min="1" step="1" defaultValue={sp.ltr ?? (calcRes.baseMonthlyMinor ? Number(calcRes.baseMonthlyMinor / 100n) : '')} className="w-28" /></div>
          <div><Label htmlFor="c-adr">{t('calc.adr')}</Label><Input id="c-adr" name="adr" type="number" min="1" step="1" defaultValue={sp.adr ?? ''} placeholder={t('calc.auto')} className="w-28" /></div>
          <div><Label htmlFor="c-occ">{t('calc.occupancy')}</Label><Input id="c-occ" name="occ" type="number" min="0" max="100" defaultValue={sp.occ ?? ''} placeholder={t('calc.auto')} className="w-24" /></div>
          <div><Label htmlFor="c-fee">{t('calc.strFee')}</Label><Input id="c-fee" name="fee" type="number" min="0" max="100" step="0.5" defaultValue={sp.fee ?? ''} placeholder={t('calc.open')} className="w-24" /></div>
          {units.filter((u) => u.type === 'APARTMENT').length > 1 ? <div><Label htmlFor="c-unit">{t('card.units')}</Label><Select id="c-unit" name="unit" defaultValue={sp.unit ?? ''} className="w-32"><option value="">{t('calc.allUnits')}</option>{units.filter((u) => u.type === 'APARTMENT').map((u) => (<option key={u.id} value={u.id}>{u.unitNo}</option>))}</Select></div> : null}
          <Button type="submit" variant="outline" size="sm">{t('calc.recalc')}</Button>
        </form>
        {!calcRes.calc ? <p className="mt-3 text-sm text-amber-700">{t('calc.noBase')}</p> : (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {calcRes.calc.scenarios.map((s) => (
                <div key={s.key} className={cn('rounded-lg border p-3', s.key === calcRes.calc!.recommended ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-200')}>
                  <div className="flex items-center justify-between"><span className="font-display text-sm font-semibold">{t(`calc.${s.key}`)}</span>{s.feeOpen ? <Badge tone="yellow">{t('calc.feeOpen')}</Badge> : null}</div>
                  <p className="mt-2 font-mono text-xl font-bold text-gray-900">{fmtRate(s.ownerNetMonthlyMinor, calcRes.currency)}<span className="text-xs font-normal text-gray-500">{t('calc.perMonth')}</span></p>
                  <dl className="mt-2 space-y-0.5 text-xs">
                    <div className="flex justify-between"><dt className="text-gray-500">{t('calc.gross')}</dt><dd className="font-mono">{fmtRate(s.grossAnnualMinor, calcRes.currency)}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-500">{t('calc.opex')}</dt><dd className="font-mono">−{fmtRate(s.opexAnnualMinor, calcRes.currency)}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-500">{t('calc.ordoFee')}</dt><dd className="font-mono">−{fmtRate(s.ordoFeeAnnualMinor, calcRes.currency)}</dd></div>
                    <div className="flex justify-between font-semibold"><dt className="text-gray-700">{t('calc.ownerNet')}</dt><dd className="font-mono">{fmtRate(s.ownerNetAnnualMinor, calcRes.currency)}</dd></div>
                  </dl>
                  <ul className="mt-2 space-y-0.5 text-[11px] text-gray-500">{s.assumptions.map((a) => (<li key={a}>· {a}</li>))}</ul>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-gray-400">{t('calc.units', { units: calcRes.units.join(', ') })}</p>
            {data.canManage ? <form action={markCalcShownAction} className="mt-3"><input type="hidden" name="ownerId" value={o.id} /><input type="hidden" name="summary" value={summary} /><Button type="submit" size="sm">{t('calc.markShown')}</Button></form> : null}
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.canManage ? (
          <Card>
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><MessageSquare className="h-4 w-4 text-brand-500" />{t('card.addActivity')}</h3>
            <form action={addOwnerActivityAction} className="mt-3 grid gap-2">
              <input type="hidden" name="ownerId" value={o.id} />
              <div className="flex flex-wrap gap-2"><Select name="kind" defaultValue="CALL" className="w-40" aria-label={t('card.activityKind')}>{ACTIVITY_KINDS.map((k) => (<option key={k} value={k}>{tD(`activity.${k}`)}</option>))}</Select><Input name="followUpAt" type="date" className="w-40" aria-label={t('card.followUp')} />{units.length > 1 ? <Select name="unitId" defaultValue="" className="w-32" aria-label={t('card.units')}><option value="">—</option>{units.map((u) => (<option key={u.id} value={u.id}>{u.unitNo}</option>))}</Select> : null}</div>
              <div className="flex gap-2"><Input name="note" placeholder={t('card.activityPlaceholder')} required className="flex-1" /><Button type="submit" size="sm">{t('card.add')}</Button></div>
            </form>
          </Card>
        ) : null}
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><History className="h-4 w-4 text-brand-500" />{t('card.history')}</h3>
          {activities.length === 0 ? <p className="mt-3 text-sm text-gray-400">{t('card.noHistory')}</p> : (
            <ul className="mt-3 space-y-2 text-sm">{activities.map((a) => (<li key={a.id}><span className="font-mono text-[10px] text-gray-400">{fmtDate(a.happenedAt)}</span> <Badge tone="gray">{tD(`activity.${a.kind}`)}</Badge>{a.unitNo ? <span className="ml-1 font-mono text-[10px] text-gray-500">{a.unitNo}</span> : null}<span className="ml-1 text-[10px] text-gray-400">{a.actor}</span><p className="text-gray-800">{a.note}</p>{a.followUpAt ? <p className="text-[11px] text-gray-500"><FileSignature className="mr-1 inline h-3 w-3" />{fmtDate(a.followUpAt)}</p> : null}</li>))}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
