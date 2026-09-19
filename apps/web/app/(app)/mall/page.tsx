import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Calculator, FileSignature, Megaphone, Store } from 'lucide-react';
import { ASSET_KINDS, can, ownerEconomics } from '@finance-os/core';
import { getMallDashboard, listMandates, listUnits } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Table, Td, Th, cn } from '@/components/ui';
import { COLOR_BG, fmtDate, fmtRate } from '@/components/property';
import { createAssetAction, createAssetContractAction, createMandateAction, endAssetContractAction, transitionMandateAction, updateMandateAction } from './actions';
import { MANDATE_TONE } from './tones';

/* P-19 — ORDO Mall: коммерческая часть (бизнес-модель Mall v1.1): GLA/загрузка, tenant mix, мандаты ДДУ, линии актива, экономика собственника. */

type Sp = Record<string, string | undefined>;
const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export default async function MallPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'mall.view')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('mall');
  const view = sp.view ?? 'overview';
  const dash = await getMallDashboard(ctx, sp.building);
  const manage = can(ctx, 'mall.manage');
  const [mandates, units] = view === 'mandates' ? await Promise.all([listMandates(ctx, { buildingId: dash.building.id }), manage ? listUnits(ctx, { buildingId: dash.building.id }) : Promise.resolve([])]) : [[], []];
  const withoutMandate = units.filter((u) => u.view.isCommercial && !dash.units.find((x) => x.id === u.id)?.mandateStatus);
  const tabs = ['overview', 'mandates', 'assets', 'calc'] as const;
  const usd = (m: bigint | null | undefined) => fmtRate(m ?? null, 'USD');
  const k = dash.kpi;
  const calcInput = { areaM2: num(sp.area, 100), rateMinor: BigInt(Math.round(num(sp.rate, 40) * 100)), indexationPct: num(sp.idx, 10), indexationPctWithout: num(sp.idx0, 0), vacancyDaysWithout: num(sp.vac0, 180), vacancyDaysWith: num(sp.vac1, 45), tenantChangesWithout: num(sp.changes, 2), brokerFeeMonths: num(sp.broker, 1), fitoutFreeMonths: num(sp.fitout, 3), discountedMonths: num(sp.disc, 9), discountPct: num(sp.discPct, 30), feeBp: sp.fee !== undefined && sp.fee !== '' ? Math.round(num(sp.fee, 0) * 100) : null, successFeeMonths: sp.success !== undefined && sp.success !== '' ? num(sp.success, 0.5) : null, ordoDeals: num(sp.deals, 1) };
  const econ = view === 'calc' ? ownerEconomics(calcInput) : null;

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} meta={<span className="text-sm text-gray-500">{dash.building.name} · {t('kpi.units', { n: k.units })}</span>} actions={<div className="flex flex-wrap gap-1.5">{tabs.map((v) => (<Link key={v} href={`/mall?view=${v}`} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', view === v ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>{t(`tab.${v}`)}</Link>))}</div>} />
      {sp.error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : t('error.GENERIC')}</div> : null}

      {view === 'overview' ? (
        <>
          <Card>
            <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-5 lg:grid-cols-9">
              <div><p className="font-mono text-base font-bold text-gray-900">{k.glaM2}</p><p className="text-[11px] text-gray-500">{t('kpi.gla')}</p></div>
              <div><p className="font-mono text-base font-bold text-emerald-600">{k.leasedGlaM2}</p><p className="text-[11px] text-gray-500">{t('kpi.leasedGla')}</p></div>
              <div><p className={cn('font-mono text-base font-bold', k.occupancyByGlaPct >= 80 ? 'text-emerald-600' : k.occupancyByGlaPct >= 60 ? 'text-amber-600' : 'text-red-600')}>{k.occupancyByGlaPct}%</p><p className="text-[11px] text-gray-500">{t('kpi.occupancy')}</p></div>
              <div><p className="font-mono text-base font-bold text-red-600">{k.vacantGlaM2}</p><p className="text-[11px] text-gray-500">{t('kpi.vacantGla')}</p></div>
              <div><p className="font-mono text-base font-bold text-gray-500">{k.renovationGlaM2}</p><p className="text-[11px] text-gray-500">{t('kpi.renovationGla')}</p></div>
              <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-900">{usd(k.currentRentMinor)}</p><p className="text-[11px] text-gray-500">{t('kpi.rent')}</p></div>
              <div><p className="font-mono text-base font-bold text-gray-900">{usd(k.avgRatePerM2Minor)}</p><p className="text-[11px] text-gray-500">{t('kpi.avgRate')}</p></div>
              <div><p className="font-mono text-base font-bold text-gray-900">{k.avgVacantDays ?? '—'}</p><p className="text-[11px] text-gray-500">{t('kpi.avgVacantDays')}</p></div>
              <div><p className={cn('font-mono text-base font-bold', k.expiring90 ? 'text-amber-600' : 'text-gray-400')}>{k.expiring90}</p><p className="text-[11px] text-gray-500">{t('kpi.expiring90')}</p></div>
            </div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <h3 className="font-display text-sm font-semibold">{t('byFloor')}</h3>
              <ul className="mt-2 divide-y divide-gray-100">{dash.byFloor.map((f) => (<li key={f.floorNo} className="flex items-center justify-between gap-2 py-1.5 text-sm"><span className="font-medium text-gray-900">{t('floor', { n: f.floorNo })}<span className="ml-2 text-xs text-gray-500">{f.kpi.glaM2} {t('sqm')}</span></span><span className="flex items-center gap-2"><span className="h-2 w-24 overflow-hidden rounded bg-gray-100"><span className="block h-full bg-emerald-500" style={{ width: `${f.kpi.occupancyByGlaPct}%` }} /></span><span className="w-12 text-right font-mono text-xs">{f.kpi.occupancyByGlaPct}%</span></span></li>))}</ul>
              <h3 className="mt-4 font-display text-sm font-semibold">{t('scenarios.title')}</h3>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center"><div><p className="font-mono text-sm font-bold text-gray-500">{usd(dash.scenarios.conservative)}</p><p className="text-[10px] text-gray-500">{t('scenarios.conservative')}</p></div><div><p className="font-mono text-sm font-bold text-gray-900">{usd(dash.scenarios.base)}</p><p className="text-[10px] text-gray-500">{t('scenarios.base')}</p></div><div><p className="font-mono text-sm font-bold text-emerald-600">{usd(dash.scenarios.optimistic)}</p><p className="text-[10px] text-gray-500">{t('scenarios.optimistic')}</p></div></div>
              <p className="mt-1 text-[11px] text-gray-400">{t('scenarios.hint')}</p>
            </Card>
            <Card>
              <h3 className="font-display text-sm font-semibold">{t('tenantMix')}</h3>
              {dash.tenantMix.length === 0 ? <p className="mt-2 text-sm text-gray-400">{t('noMix')}</p> : (
                <ul className="mt-2 space-y-1.5">{dash.tenantMix.map((l) => (<li key={l.category} className="text-sm"><div className="flex items-center justify-between gap-2"><span className="text-gray-900">{t(`category.${l.category}`)}<span className="ml-2 text-xs text-gray-500">{l.units} · {l.glaM2} {t('sqm')}</span></span><span className="font-mono text-xs">{l.sharePct}%</span></div><div className="mt-0.5 h-1.5 overflow-hidden rounded bg-gray-100"><div className="h-full bg-brand-500" style={{ width: `${l.sharePct}%` }} /></div></li>))}</ul>
              )}
              <h3 className="mt-4 font-display text-sm font-semibold">{t('pipeline.title')}</h3>
              <p className="mt-1 text-xs text-gray-500">{dash.pipeline.deals ? t('pipeline.deals', { n: dash.pipeline.deals }) : t('pipeline.none')}</p>
              {dash.pipeline.byCategory.length ? <p className="mt-1 text-xs text-gray-600">{dash.pipeline.byCategory.map(([c, n]) => `${t(`category.${c as never}`)}: ${n}`).join(' · ')}</p> : null}
            </Card>
            <Card>
              <div className="flex items-center gap-2"><FileSignature className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('mandatesBlock.title')}</h3></div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div><p className="font-mono text-base font-bold text-gray-900">{dash.mandates.withMandate}/{dash.mandates.owners}</p><p className="text-[10px] text-gray-500">{t('mandatesBlock.withMandate')} / {t('mandatesBlock.owners')}</p></div>
                <div><p className="font-mono text-base font-bold text-emerald-600">{dash.mandates.active}</p><p className="text-[10px] text-gray-500">{t('mandatesBlock.active')} · {dash.mandates.signed} {t('mandatesBlock.signed')}</p></div>
                <div><p className="font-mono text-base font-bold text-gray-900">{dash.mandates.coverageGlaPct}%</p><p className="text-[10px] text-gray-500">{t('mandatesBlock.coverage')}</p></div>
              </div>
              {dash.controlled ? (
                <dl className="mt-3 space-y-1 border-t border-gray-100 pt-2 text-[13px]">
                  <div className="flex justify-between"><dt className="text-gray-500">{t('mandatesBlock.charged')}</dt><dd className="font-mono">{usd(dash.controlled.chargedMinor)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">{t('mandatesBlock.collected')}</dt><dd className="font-mono text-emerald-600">{usd(dash.controlled.collectedMinor)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">{t('mandatesBlock.fee')}</dt><dd className="font-mono">{dash.controlled.feeMinor == null ? '—' : usd(dash.controlled.feeMinor)}{dash.controlled.feeOpenUnits ? <span className="ml-1 text-[10px] text-amber-600">{t('mandatesBlock.feeOpen', { n: dash.controlled.feeOpenUnits })}</span> : null}</dd></div>
                </dl>
              ) : null}
              <p className="mt-2 text-[11px] text-gray-400">{t('mandatesBlock.feeHint')}</p>
              <div className="mt-3 flex items-center gap-2"><Megaphone className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('assetsBlock.title')}</h3></div>
              <p className="mt-1 font-mono text-base font-bold text-gray-900">{usd(dash.assets.monthlyMinor)} <span className="text-[11px] font-normal text-gray-500">{t('assetsBlock.monthly')}</span></p>
              <ul className="mt-1 text-xs text-gray-600">{dash.assets.byKind.map((b) => (<li key={b.kind} className="flex justify-between py-0.5"><span>{t(`assetsBlock.kind.${b.kind}`)} · {b.assets}</span><span className="font-mono">{usd(b.monthlyMinor)}</span></li>))}</ul>
            </Card>
          </div>
        </>
      ) : null}

      {view === 'mandates' ? (
        <>
          {manage && withoutMandate.length ? (
            <Card>
              <h3 className="font-display text-sm font-semibold">{t('mandate.newTitle')}</h3>
              <form action={createMandateAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <div className="lg:col-span-2"><Label htmlFor="m-unit">{t('mandate.unit')}</Label><Select id="m-unit" name="unitId" required>{withoutMandate.map((u) => (<option key={u.id} value={u.id}>{u.unitNo} · {u.areaM2} {t('sqm')} · {u.ownerName ?? '—'}</option>))}</Select></div>
                <div><Label htmlFor="m-fee">{t('mandate.feePct')}</Label><Input id="m-fee" name="feePct" type="number" min="0" max="100" step="0.1" placeholder={t('mandate.feeOpen')} /></div>
                <div><Label htmlFor="m-sf">{t('mandate.successFee')}</Label><Input id="m-sf" name="successFee" type="number" min="0" max="12" step="0.5" /></div>
                <div><Label htmlFor="m-start">{t('mandate.startAt')}</Label><Input id="m-start" name="startAt" type="date" /></div>
                <div className="self-end"><Button type="submit">{t('mandate.create')}</Button></div>
              </form>
            </Card>
          ) : null}
          {mandates.length === 0 ? <EmptyState icon={<FileSignature />} text={t('mandate.empty')} /> : (
            <Table>
              <thead><tr><Th>{t('mandate.unit')}</Th><Th>{t('mandate.owner')}</Th><Th>{t('mandate.occupant')}</Th><Th className="text-right">{t('mandate.rent')}</Th><Th>{t('mandate.feePct')}</Th><Th>{t('mandate.status')}</Th><Th>{t('mandate.signedAt')}</Th>{manage ? <Th /> : null}</tr></thead>
              <tbody>
                {mandates.map((m) => (
                  <tr key={m.id}>
                    <Td><Link href={`/property/units/${m.unitId}`} className="font-mono font-semibold text-ink-900 hover:text-brand-600">{m.unitNo}</Link><span className="ml-2 text-xs text-gray-500">{m.areaM2} {t('sqm')}</span></Td>
                    <Td className="text-gray-800">{m.ownerName}</Td>
                    <Td className="text-xs text-gray-600">{m.occupantName ?? '—'}</Td>
                    <Td className="text-right font-mono text-xs">{m.monthlyRentMinor != null ? usd(m.monthlyRentMinor) : '—'}</Td>
                    <Td className="text-xs">{manage && m.status !== 'TERMINATED' ? (
                      <form action={updateMandateAction} className="flex items-center gap-1"><input type="hidden" name="id" value={m.id} /><Input name="feePct" type="number" min="0" max="100" step="0.1" defaultValue={m.feeBp != null ? (m.feeBp / 100).toString() : ''} className="h-8 w-20 py-0 text-xs" placeholder="—" /><Input name="successFee" type="number" min="0" max="12" step="0.5" defaultValue={m.successFee ?? ''} className="h-8 w-16 py-0 text-xs" placeholder={t('mo')} /><Button type="submit" size="sm" variant="outline">{t('mandate.saveFee')}</Button></form>
                    ) : (m.feeBp != null ? `${m.feeBp / 100}%` : t('mandate.feeOpen'))}
                      {m.feeBp != null ? <span className={cn('mt-0.5 block text-[10px]', m.feePublished ? 'text-emerald-600' : 'text-gray-400')}>{m.feePublished ? t('mandate.published') : '—'}</span> : null}
                    </Td>
                    <Td><Badge tone={MANDATE_TONE[m.status]} dot>{t(`mandate.status_.${m.status}`)}</Badge></Td>
                    <Td className="font-mono text-xs text-gray-600">{fmtDate(m.signedAt)}{m.startAt ? ` → ${fmtDate(m.startAt)}` : ''}</Td>
                    {manage ? (
                      <Td>
                        <div className="flex flex-wrap items-center gap-1">
                          {m.status === 'DRAFT' ? <form action={transitionMandateAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="trigger" value="sign" /><Button type="submit" size="sm" variant="outline">{t('mandate.sign')}</Button></form> : null}
                          {m.status === 'SIGNED' ? <form action={transitionMandateAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="trigger" value="activate" /><Button type="submit" size="sm">{t('mandate.activate')}</Button></form> : null}
                          {m.feeBp != null && m.status !== 'TERMINATED' ? <form action={updateMandateAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="feePublished" value={m.feePublished ? '0' : '1'} /><Button type="submit" size="sm" variant="outline">{m.feePublished ? t('mandate.unpublish') : t('mandate.publish')}</Button></form> : null}
                          {m.status !== 'TERMINATED' ? <form action={transitionMandateAction} className="flex items-center gap-1"><input type="hidden" name="id" value={m.id} /><input type="hidden" name="trigger" value="terminate" /><Input name="reason" placeholder={t('mandate.reason')} className="h-8 w-28 py-0 text-xs" required /><Button type="submit" size="sm" variant="danger">{t('mandate.terminate')}</Button></form> : null}
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      ) : null}

      {view === 'assets' ? (
        <>
          {manage ? (
            <Card>
              <h3 className="font-display text-sm font-semibold">{t('asset.newTitle')}</h3>
              <form action={createAssetAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <input type="hidden" name="buildingId" value={dash.building.id} />
                <div><Label htmlFor="a-kind">{t('asset.kind')}</Label><Select id="a-kind" name="kind" defaultValue="MEDIA">{ASSET_KINDS.map((k2) => (<option key={k2} value={k2}>{t(`assetsBlock.kind.${k2}`)}</option>))}</Select></div>
                <div><Label htmlFor="a-code">{t('asset.code')}</Label><Input id="a-code" name="code" required placeholder="LED-01" /></div>
                <div className="lg:col-span-2"><Label htmlFor="a-name">{t('asset.name')}</Label><Input id="a-name" name="name" required /></div>
                <div><Label htmlFor="a-loc">{t('asset.location')}</Label><Input id="a-loc" name="location" /></div>
                <div><Label htmlFor="a-tariff">{t('asset.tariff')}</Label><Input id="a-tariff" name="tariff" type="number" min="0" step="0.01" /></div>
                <div className="self-end"><Button type="submit">{t('asset.create')}</Button></div>
              </form>
              <p className="mt-2 text-[11px] text-gray-400">{t('assetsBlock.hint')}</p>
            </Card>
          ) : null}
          {dash.assets.list.length === 0 ? <EmptyState icon={<Megaphone />} text={t('asset.empty')} /> : (
            <div className="grid gap-3 lg:grid-cols-2">
              {dash.assets.list.map((a) => (
                <Card key={a.id}>
                  <div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-gray-900">{a.name}<span className="ml-2 font-mono text-xs text-gray-400">{a.code}</span></p><p className="text-xs text-gray-500">{t(`assetsBlock.kind.${a.kind}`)}{a.location ? ` · ${a.location}` : ''}{a.tariffMinor != null ? ` · ${usd(a.tariffMinor)}/${t('mo')}` : ''}</p></div><span className="font-mono text-sm font-bold text-emerald-600">{usd(a.monthlyMinor)}</span></div>
                  <ul className="mt-2 divide-y divide-gray-100 text-xs">
                    {a.contracts.length === 0 ? <li className="py-1 text-gray-400">{t('asset.noContracts')}</li> : null}
                    {a.contracts.map((c) => (<li key={c.id} className="flex items-center justify-between gap-2 py-1"><span><span className="text-gray-900">{c.counterpartyName}</span><span className="ml-2 font-mono text-gray-500">{fmtDate(c.startAt)} → {c.endAt ? fmtDate(c.endAt) : '∞'}</span></span><span className="flex items-center gap-2"><span className="font-mono">{usd(c.monthlyMinor)}</span><Badge tone={c.status === 'ACTIVE' ? 'green' : 'gray'}>{t(`asset.status.${c.status}`)}</Badge>{manage && c.status === 'ACTIVE' ? <form action={endAssetContractAction}><input type="hidden" name="id" value={c.id} /><Button type="submit" size="sm" variant="outline">{t('asset.end')}</Button></form> : null}</span></li>))}
                  </ul>
                  {manage ? (
                    <form action={createAssetContractAction} className="mt-2 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-2"><input type="hidden" name="assetId" value={a.id} /><div className="flex-1"><Label htmlFor={`c-${a.id}`}>{t('asset.counterparty')}</Label><Input id={`c-${a.id}`} name="counterpartyName" required className="h-8 py-0 text-xs" /></div><div><Label htmlFor={`m-${a.id}`}>{t('asset.monthly')}</Label><Input id={`m-${a.id}`} name="monthly" type="number" min="0.01" step="0.01" required className="h-8 w-24 py-0 text-xs" /></div><div><Label htmlFor={`s-${a.id}`}>{t('asset.startAt')}</Label><Input id={`s-${a.id}`} name="startAt" type="date" required className="h-8 py-0 text-xs" /></div><div><Label htmlFor={`e-${a.id}`}>{t('asset.endAt')}</Label><Input id={`e-${a.id}`} name="endAt" type="date" className="h-8 py-0 text-xs" /></div><Button type="submit" size="sm" variant="outline">{t('asset.addContract')}</Button></form>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </>
      ) : null}

      {view === 'calc' && econ ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <Card>
            <div className="flex items-center gap-2"><Calculator className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('calc.title')}</h3></div>
            <p className="mt-1 text-xs text-gray-500">{t('calc.hint')}</p>
            <form className="mt-3 grid grid-cols-2 gap-2">
              <input type="hidden" name="view" value="calc" />
              {([['area', 'area', calcInput.areaM2], ['rate', 'rate', Number(calcInput.rateMinor) / 100], ['idx', 'indexation', calcInput.indexationPct], ['idx0', 'indexationWithout', calcInput.indexationPctWithout], ['vac0', 'vacancyWithout', calcInput.vacancyDaysWithout], ['vac1', 'vacancyWith', calcInput.vacancyDaysWith], ['changes', 'changes', calcInput.tenantChangesWithout], ['broker', 'brokerMonths', calcInput.brokerFeeMonths], ['fitout', 'fitout', calcInput.fitoutFreeMonths], ['disc', 'discounted', calcInput.discountedMonths], ['discPct', 'discountPct', calcInput.discountPct], ['deals', 'deals', calcInput.ordoDeals]] as const).map(([name, key, val]) => (
                <div key={name}><Label htmlFor={`k-${name}`}>{t(`calc.${key}`)}</Label><Input id={`k-${name}`} name={name} type="number" step="any" defaultValue={String(val)} /></div>
              ))}
              <div><Label htmlFor="k-fee">{t('calc.feePct')}</Label><Input id="k-fee" name="fee" type="number" step="0.1" defaultValue={calcInput.feeBp != null ? (calcInput.feeBp / 100).toString() : ''} /></div>
              <div><Label htmlFor="k-success">{t('calc.successMonths')}</Label><Input id="k-success" name="success" type="number" step="0.5" defaultValue={calcInput.successFeeMonths ?? ''} /></div>
              <div className="col-span-2"><Button type="submit">{t('calc.run')}</Button></div>
            </form>
          </Card>
          <Card>
            <Table>
              <thead><tr><Th /><Th className="text-right">{t('calc.without')}</Th><Th className="text-right">{t('calc.with')}</Th></tr></thead>
              <tbody>
                <tr><Td>{t('calc.gross')}</Td><Td className="text-right font-mono">{usd(econ.without.grossMinor)}</Td><Td className="text-right font-mono">{usd(econ.with.grossMinor)}</Td></tr>
                <tr><Td>{t('calc.vacancy')}</Td><Td className="text-right font-mono text-red-600">−{usd(econ.without.vacancyMinor)}</Td><Td className="text-right font-mono text-red-600">−{usd(econ.with.vacancyMinor)}</Td></tr>
                <tr><Td>{t('calc.broker')}</Td><Td className="text-right font-mono text-red-600">−{usd(econ.without.brokerMinor)}</Td><Td className="text-right font-mono text-gray-400">—</Td></tr>
                <tr><Td>{t('calc.concessions')}</Td><Td className="text-right font-mono text-gray-400">—</Td><Td className="text-right font-mono text-red-600">−{usd(econ.with.concessionsMinor)}</Td></tr>
                <tr><Td>{t('calc.fee')}</Td><Td className="text-right font-mono text-gray-400">—</Td><Td className="text-right font-mono text-red-600">{econ.with.feeMinor == null ? '—' : `−${usd(econ.with.feeMinor)}`}</Td></tr>
                <tr><Td>{t('calc.successFee')}</Td><Td className="text-right font-mono text-gray-400">—</Td><Td className="text-right font-mono text-red-600">{econ.with.successFeeMinor == null ? '—' : `−${usd(econ.with.successFeeMinor)}`}</Td></tr>
                <tr className="font-semibold"><Td>{t('calc.net')}</Td><Td className="text-right font-mono">{usd(econ.without.netMinor)}</Td><Td className="text-right font-mono">{econ.with.netMinor == null ? '—' : usd(econ.with.netMinor)}</Td></tr>
              </tbody>
            </Table>
            <p className={cn('mt-3 font-mono text-lg font-bold', econ.deltaMinor == null ? 'text-gray-400' : econ.deltaMinor >= 0n ? 'text-emerald-600' : 'text-red-600')}>{t('calc.delta')}: {econ.deltaMinor == null ? t('calc.feeNotSet') : `${econ.deltaMinor >= 0n ? '+' : '−'}${usd(econ.deltaMinor < 0n ? -econ.deltaMinor : econ.deltaMinor)}`}</p>
          </Card>
        </div>
      ) : null}
      {view === 'overview' ? (
        <Card>
          <div className="flex items-center gap-2"><Store className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{dash.building.name}</h3></div>
          <div className="mt-2 flex flex-wrap gap-1">{dash.units.map((u) => (<Link key={u.id} href={`/property/units/${u.id}`} title={`${u.unitNo} · ${u.areaM2} ${t('sqm')}${u.tenantCategory ? ` · ${t(`category.${u.tenantCategory}`)}` : ''}${u.mandateStatus ? ` · ${t('mandateShort')} ${t(`mandate.status_.${u.mandateStatus}`)}` : ''}`} className={cn('rounded-[3px] px-2 py-1 font-mono text-[11px] font-semibold', u.occupied ? COLOR_BG.GREEN : u.readiness !== 'READY' ? COLOR_BG.GREY : COLOR_BG.RED, u.mandateStatus === 'ACTIVE' ? 'ring-2 ring-brand-500' : '')}>{u.unitNo}</Link>))}</div>
        </Card>
      ) : null}
    </div>
  );
}
