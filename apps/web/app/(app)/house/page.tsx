import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Building2, ClipboardList, Coins, FileText, Landmark, Scale, Users } from 'lucide-react';
import { HOUSE_BUDGET_CATEGORIES, HOUSE_FUND_KINDS, NotFoundError, can } from '@finance-os/core';
import { getHouseDashboard, getTransparencyReport, listBuildings, listHouseBankAccounts, listHouseCharges, listHouseFunds, listHouseIncoming, managementContractCoverage } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Table, Td, Th, cn } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';
import { addHouseExpenseAction, createHouseFundAction, matchHouseReceiptAction, updateHouseFundAction, upsertHouseBudgetLineAction } from './actions';
import { HOUSE_TONE } from './tones';

/* ORDO Operations — деньги дома (docs/20 §11.13): фонд, взносы по кадастру, зачёт банком, бюджет/факт, перерасчёт, отчёт прозрачности. */

const PAGE = 100;
const VIEWS = ['overview', 'charges', 'budget', 'report'] as const;
type View = (typeof VIEWS)[number];
const ym = (d: Date) => d.toISOString().slice(0, 7);
const Stat = ({ v, k, tone }: { v: string; k: string; tone?: string | undefined }) => (<div><p className={cn('font-mono text-base font-bold whitespace-nowrap', tone ?? 'text-gray-900')}>{v}</p><p className="text-[11px] text-gray-500">{k}</p></div>);

export default async function HousePage({ searchParams }: { searchParams: Promise<{ view?: string; fund?: string; error?: string; page?: string; period?: string; year?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'house.view')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('house');
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? '') ? (sp.view as View) : 'overview';
  const manage = can(ctx, 'house.manage');
  const now = new Date();
  const funds = await listHouseFunds(ctx);
  const fund = (sp.fund ? funds.find((f) => f.id === sp.fund) : null) ?? funds.find((f) => f.active && f.kind === 'OPERATIONS') ?? funds[0] ?? null;
  const q = (v: View, extra = '') => `/house?view=${v}${fund ? `&fund=${fund.id}` : ''}${extra}`;
  const err = sp.error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : t('error.GENERIC')}</div> : null;
  const [buildings, accounts] = manage ? await Promise.all([listBuildings(ctx), listHouseBankAccounts(ctx)]) : [[], []];

  const fundForm = manage ? (
    <Card>
      <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Landmark className="h-4 w-4 text-brand-500" />{t('fund.new')}</h3>
      <p className="mt-1 text-xs text-gray-500">{t('fund.hint')}</p>
      <form action={createHouseFundAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input type="hidden" name="back" value="/house" />
        <div><Label htmlFor="f-name">{t('fund.name')}</Label><Input id="f-name" name="name" required /></div>
        <div><Label htmlFor="f-b">{t('fund.building')}</Label><Select id="f-b" name="buildingId"><option value="">—</option>{buildings.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}</Select></div>
        <div><Label htmlFor="f-k">{t('fund.kind')}</Label><Select id="f-k" name="kind" defaultValue="OPERATIONS">{HOUSE_FUND_KINDS.map((k) => (<option key={k} value={k}>{t(`kind.${k}`)}</option>))}</Select></div>
        <div><Label htmlFor="f-acc">{t('fund.account')}</Label><Select id="f-acc" name="bankAccountId"><option value="">—</option>{accounts.map((a) => (<option key={a.id} value={a.id}>{a.bankName} · {a.accountMasked} · {a.currency}</option>))}</Select></div>
        <div><Label htmlFor="f-t">{t('fund.tariff')}</Label><Input id="f-t" name="tariff" type="number" min="0" step="1" required /></div>
        <div><Label htmlFor="f-d">{t('fund.dueDay')}</Label><Input id="f-d" name="dueDay" type="number" min="1" max="28" defaultValue={15} /></div>
        <div><Label htmlFor="f-fee">{t('fund.feePct')}</Label><Input id="f-fee" name="feePct" type="number" min="0" max="100" step="0.1" placeholder={t('fund.feeOpen')} /></div>
        <div><Label htmlFor="f-ap">{t('fund.tariffApprovedAt')}</Label><Input id="f-ap" name="tariffApprovedAt" type="date" /></div>
        <div className="self-end sm:col-span-2 lg:col-span-4"><Button type="submit">{t('fund.create')}</Button></div>
      </form>
    </Card>
  ) : null;

  if (!fund) {
    return (<div className="space-y-5"><PageHeader title={t('title')} />{err}<EmptyState icon={<Landmark />} text={t('noFund')} />{fundForm}</div>);
  }

  const year = Number(sp.year ?? now.getUTCFullYear()) || now.getUTCFullYear();
  let dash: Awaited<ReturnType<typeof getHouseDashboard>> | null = null;
  try { dash = await getHouseDashboard(ctx, fund.id, year, now); } catch (e) { if (!(e instanceof NotFoundError)) throw e; }
  const coverage = await managementContractCoverage(ctx);
  const cur = fund.currency;
  const feeStr = fund.managementFeeBp != null ? `${fund.managementFeeBp / 100}%` : t('fund.feeOpen');

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        meta={<span className="flex flex-wrap items-center gap-2"><Badge tone="gray">{fund.name}</Badge><Badge tone={fund.tariffApprovedAt ? 'green' : 'yellow'} dot>{fund.tariffApprovedAt ? t('tariffApproved', { d: fmtDate(fund.tariffApprovedAt) }) : t('tariffNotApproved')}</Badge>{funds.length > 1 ? <span className="flex gap-1">{funds.map((f) => (<Link key={f.id} href={`/house?view=${view}&fund=${f.id}`} className={cn('rounded px-2 py-0.5 text-xs', f.id === fund.id ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600')}>{f.name}</Link>))}</span> : null}</span>}
        actions={<div className="flex flex-wrap gap-1.5">{VIEWS.map((v) => (<Link key={v} href={q(v)} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', view === v ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>{t(`tab.${v}`)}</Link>))}</div>}
      />
      {err}

      {view === 'overview' && dash ? (
        <>
          <Card>
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Coins className="h-4 w-4 text-brand-500" />{t('money.title', { year })}</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-3 lg:grid-cols-6">
              <Stat v={fmtRate(dash.money.chargedMinor, cur)} k={t('money.charged')} />
              <Stat v={fmtRate(dash.money.collectedMinor, cur)} k={t('money.collected')} tone="text-emerald-600" />
              <Stat v={dash.money.collectionPct == null ? '—' : `${dash.money.collectionPct}%`} k={t('money.collection')} tone={dash.money.collectionPct != null && dash.money.collectionPct < 70 ? 'text-red-600' : undefined} />
              <Stat v={fmtRate(dash.money.overdueMinor, cur)} k={t('money.overdue')} tone={dash.money.overdueMinor > 0n ? 'text-red-600' : 'text-gray-400'} />
              <Stat v={fmtRate(dash.money.spentMinor, cur)} k={t('money.spent')} />
              <Stat v={dash.money.managementFeeMinor == null ? (dash.money.feeOpen ? t('fund.feeOpen') : '—') : fmtRate(dash.money.managementFeeMinor, cur)} k={t('money.fee')} tone="text-gray-600" />
            </div>
            <p className="mt-2 text-[11px] text-gray-400">{t('money.hint')}</p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Scale className="h-4 w-4 text-brand-500" />{t('recalc.title')}</h3>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-gray-500">{t('recalc.balance')}</dt><dd className={cn('font-mono', dash.recalc.balanceMinor < 0n ? 'text-red-600' : 'text-gray-900')}>{fmtRate(dash.recalc.balanceMinor, cur)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">{t('recalc.credit')}</dt><dd className="font-mono text-emerald-600">{fmtRate(dash.recalc.carryForwardCreditMinor, cur)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">{t('recalc.shortfall')}</dt><dd className="font-mono text-red-600">{fmtRate(dash.recalc.shortfallMinor, cur)}</dd></div>
              </dl>
              <p className="mt-2 text-[11px] text-gray-400">{t('recalc.hint')}</p>
              <h4 className="mt-4 text-xs font-semibold text-gray-700">{t('scenarios.title')}</h4>
              <ul className="mt-1 space-y-0.5 text-xs">{dash.scenarios.map((s) => (<li key={s.pct} className="flex justify-between"><span className="text-gray-500">{s.pct}%</span><span className="font-mono">{fmtRate(s.collectedMinor, cur)}</span></li>))}</ul>
            </Card>
            <Card>
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Building2 className="h-4 w-4 text-brand-500" />{t('units.title')}</h3>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-gray-500">{t('units.total')}</dt><dd className="font-mono">{dash.units.total}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">{t('units.withOwner')}</dt><dd className="font-mono">{dash.units.withOwner}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">{t('units.preCadastre')}</dt><dd className={cn('font-mono', dash.units.preCadastre ? 'text-amber-600' : '')}>{dash.units.preCadastre}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">{t('units.payableArea')}</dt><dd className="font-mono">{dash.units.payableAreaM2} {t('sqm')}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">{t('units.tariff')}</dt><dd className="font-mono">{fmtRate(fund.tariffPerM2Minor, cur)}{t('perM2')}</dd></div>
              </dl>
              {dash.units.withoutOwner.length ? <p className="mt-2 text-xs text-amber-700">{t('units.withoutOwner')}: <span className="font-mono">{dash.units.withoutOwner.join(', ')}</span></p> : null}
              <h4 className="mt-4 flex items-center gap-1 text-xs font-semibold text-gray-700"><Users className="h-3.5 w-3.5" />{t('contracts.title')}</h4>
              <p className="mt-1 text-xs text-gray-600">{t('contracts.line', { signed: coverage.signed, sent: coverage.sent, none: coverage.none + coverage.declined, total: coverage.total })} · <Link href="/property/owners" className="text-brand-600 hover:underline">{t('contracts.manage')}</Link></p>
            </Card>
            <Card>
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-red-500" />{t('debtors.title')}</h3>
              {dash.debtors.length === 0 ? <p className="mt-2 text-sm text-gray-400">{t('debtors.none')}</p> : (
                <ul className="mt-2 divide-y divide-gray-100 text-sm">{dash.debtors.map((d) => (<li key={d.ownerId} className="flex items-center justify-between py-1.5"><span><span className="font-medium text-gray-900">{d.ownerName}</span><span className="ml-2 font-mono text-xs text-gray-500">{d.unitNos.join(', ')}</span></span><span className="text-right"><span className="font-mono font-semibold">{fmtRate(d.outstandingMinor, cur)}</span>{d.daysOverdue ? <span className="ml-1 text-[10px] text-red-600">{t('debtors.days', { n: d.daysOverdue })}</span> : null}</span></li>))}</ul>
              )}
              <p className="mt-2 text-[11px] text-gray-400">{t('debtors.hint')}</p>
            </Card>
          </div>

          {dash.byMonth.length ? (
            <Card>
              <h3 className="font-display text-sm font-semibold">{t('byMonth.title')}</h3>
              <Table>
                <thead><tr><Th>{t('byMonth.month')}</Th><Th className="text-right">{t('money.charged')}</Th><Th className="text-right">{t('money.collected')}</Th><Th className="text-right">{t('money.collection')}</Th><Th /></tr></thead>
                <tbody>{dash.byMonth.map((m) => { const pct = Math.round(Number((m.collectedMinor * 1000n) / m.chargedMinor)) / 10; const p = `${year}-${String(m.month).padStart(2, '0')}`; return (<tr key={m.month}><Td className="font-mono text-xs">{p}</Td><Td className="text-right font-mono">{fmtRate(m.chargedMinor, cur)}</Td><Td className="text-right font-mono text-emerald-600">{fmtRate(m.collectedMinor, cur)}</Td><Td className={cn('text-right font-mono', pct < 70 ? 'text-red-600' : '')}>{pct}%</Td><Td><Link href={q('report', `&period=${p}`)} className="text-xs text-brand-600 hover:underline">{t('byMonth.report')}</Link></Td></tr>); })}</tbody>
              </Table>
            </Card>
          ) : null}

          {manage ? (
            <Card>
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Landmark className="h-4 w-4 text-brand-500" />{t('fund.settings')}</h3>
              <form action={updateHouseFundAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <input type="hidden" name="fundId" value={fund.id} /><input type="hidden" name="back" value={q('overview')} />
                <div><Label htmlFor="u-t">{t('fund.tariff')}</Label><Input id="u-t" name="tariff" type="number" min="0" step="1" defaultValue={Number(fund.tariffPerM2Minor / 100n)} /></div>
                <div><Label htmlFor="u-d">{t('fund.dueDay')}</Label><Input id="u-d" name="dueDay" type="number" min="1" max="28" defaultValue={fund.dueDay} /></div>
                <div><Label htmlFor="u-fee">{t('fund.feePct')} · {feeStr}</Label><Input id="u-fee" name="feePct" type="number" min="0" max="100" step="0.1" placeholder={t('fund.feeOpen')} /></div>
                <div><Label htmlFor="u-ap">{t('fund.tariffApprovedAt')}</Label><Input id="u-ap" name="tariffApprovedAt" type="date" /></div>
                <div><Label htmlFor="u-acc">{t('fund.account')}</Label><Select id="u-acc" name="bankAccountId" defaultValue=""><option value="">{fund.bankAccountId ? t('fund.accountKeep') : '—'}</option>{accounts.map((a) => (<option key={a.id} value={a.id}>{a.bankName} · {a.accountMasked} · {a.currency}</option>))}</Select></div>
                <div className="self-end lg:col-span-5"><Button type="submit" variant="outline">{t('fund.save')}</Button></div>
              </form>
              <p className="mt-2 text-[11px] text-gray-400">{t('fund.feeHint')}</p>
            </Card>
          ) : null}
          {fundForm}
        </>
      ) : null}

      {view === 'charges' ? await ChargesView({ ctx, fundId: fund.id, cur, sp, q, t, now }) : null}

      {view === 'budget' && dash ? (
        <>
          <Card>
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><ClipboardList className="h-4 w-4 text-brand-500" />{t('budget.title', { year })}</h3>
            <p className="mt-1 text-xs text-gray-500">{t('budget.hint')}</p>
            <Table>
              <thead><tr><Th>{t('budget.category')}</Th><Th className="text-right">{t('budget.planned')}</Th><Th className="text-right">{t('budget.actual')}</Th><Th className="text-right">{t('budget.variance')}</Th><Th>{t('budget.floor')}</Th></tr></thead>
              <tbody>
                {dash.budget.map((l) => (<tr key={l.category}><Td className="text-gray-800">{t(`cat.${l.category}`)}</Td><Td className="text-right font-mono">{fmtRate(l.plannedMinor, cur)}</Td><Td className="text-right font-mono">{fmtRate(l.actualMinor, cur)}</Td><Td className={cn('text-right font-mono', l.varianceMinor < 0n ? 'text-red-600' : 'text-emerald-600')}>{fmtRate(l.varianceMinor, cur)}</Td><Td>{l.complianceFloor ? <Badge tone="yellow">{t('budget.floorBadge')}</Badge> : null}</Td></tr>))}
                <tr><Td className="font-semibold">{t('budget.total')}</Td><Td className="text-right font-mono font-semibold">{fmtRate(dash.plannedTotalMinor, cur)}</Td><Td className="text-right font-mono font-semibold">{fmtRate(dash.money.spentMinor, cur)}</Td><Td className={cn('text-right font-mono font-semibold', dash.plannedTotalMinor - dash.money.spentMinor < 0n ? 'text-red-600' : 'text-emerald-600')}>{fmtRate(dash.plannedTotalMinor - dash.money.spentMinor, cur)}</Td><Td /></tr>
              </tbody>
            </Table>
            {manage ? (
              <form action={upsertHouseBudgetLineAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto]">
                <input type="hidden" name="fundId" value={fund.id} /><input type="hidden" name="year" value={year} /><input type="hidden" name="back" value={q('budget')} />
                <div><Label htmlFor="b-c">{t('budget.category')}</Label><Select id="b-c" name="category">{HOUSE_BUDGET_CATEGORIES.map((c) => (<option key={c} value={c}>{t(`cat.${c}`)}</option>))}</Select></div>
                <div><Label htmlFor="b-p">{t('budget.plannedYear')}</Label><Input id="b-p" name="planned" type="number" min="0" step="1" required /></div>
                <div><Label htmlFor="b-n">{t('budget.note')}</Label><Input id="b-n" name="note" /></div>
                <div className="self-end"><Button type="submit" variant="outline">{t('budget.save')}</Button></div>
              </form>
            ) : null}
          </Card>
          <Card>
            <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><FileText className="h-4 w-4 text-brand-500" />{t('expense.title')}</h3>
            <p className="mt-1 text-xs text-gray-500">{t('expense.hint')}</p>
            {manage ? (
              <form action={addHouseExpenseAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <input type="hidden" name="fundId" value={fund.id} /><input type="hidden" name="back" value={q('budget')} />
                <div><Label htmlFor="e-d">{t('expense.date')}</Label><Input id="e-d" name="date" type="date" required defaultValue={now.toISOString().slice(0, 10)} /></div>
                <div><Label htmlFor="e-c">{t('budget.category')}</Label><Select id="e-c" name="category">{HOUSE_BUDGET_CATEGORIES.map((c) => (<option key={c} value={c}>{t(`cat.${c}`)}</option>))}</Select></div>
                <div><Label htmlFor="e-a">{t('expense.amount')}</Label><Input id="e-a" name="amount" type="number" min="1" step="1" required /></div>
                <div><Label htmlFor="e-k">{t('expense.contractor')}</Label><Input id="e-k" name="contractorName" required /></div>
                <div><Label htmlFor="e-desc">{t('expense.description')}</Label><Input id="e-desc" name="description" required /></div>
                <div className="self-end"><Button type="submit">{t('expense.add')}</Button></div>
              </form>
            ) : null}
            {dash.expenses.length === 0 ? <p className="mt-3 text-sm text-gray-400">{t('expense.none')}</p> : (
              <Table>
                <thead><tr><Th>{t('expense.date')}</Th><Th>{t('budget.category')}</Th><Th>{t('expense.contractor')}</Th><Th>{t('expense.description')}</Th><Th className="text-right">{t('expense.amount')}</Th><Th>{t('expense.evidence')}</Th></tr></thead>
                <tbody>{dash.expenses.map((e) => (<tr key={e.id}><Td className="font-mono text-xs">{fmtDate(e.date)}</Td><Td>{t(`cat.${e.category}`)}</Td><Td className="text-gray-800">{e.contractorName}</Td><Td className="text-xs text-gray-600">{e.description}</Td><Td className="text-right font-mono">{fmtRate(e.amountMinor, e.currency)}</Td><Td>{e.documentId || e.paymentRequestId ? <Badge tone="green">{t('expense.hasEvidence')}</Badge> : <Badge tone="yellow">{t('expense.noEvidence')}</Badge>}</Td></tr>))}</tbody>
              </Table>
            )}
          </Card>
        </>
      ) : null}

      {view === 'report' ? await ReportView({ ctx, fundId: fund.id, cur, period: sp.period ?? ym(now), q, t }) : null}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<'house'>>>;
type Ctx = Awaited<ReturnType<typeof requireTenantContext>>;

async function ChargesView({ ctx, fundId, cur, sp, q, t, now }: { ctx: Ctx; fundId: string; cur: string; sp: { page?: string; status?: string }; q: (v: View, extra?: string) => string; t: T; now: Date }) {
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const rows = await listHouseCharges(ctx, { fundId, status: ['DUE', 'PARTIAL', 'OVERDUE', 'PAID', 'WAIVED'], take: PAGE + 1, skip: (page - 1) * PAGE }, now);
  const hasNext = rows.length > PAGE; if (hasNext) rows.pop();
  const openCharges = rows.filter((r) => ['DUE', 'PARTIAL', 'OVERDUE'].includes(r.status));
  const incoming = can(ctx, 'rent.match') ? await listHouseIncoming(ctx, fundId) : [];
  return (
    <>
      {can(ctx, 'rent.match') ? (
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Landmark className="h-4 w-4 text-brand-500" />{t('match.title')}</h3>
          <p className="mt-1 text-xs text-gray-500">{t('match.hint')}</p>
          {incoming.length === 0 ? <p className="mt-2 text-sm text-gray-400">{t('match.noTx')}</p> : (
            <form action={matchHouseReceiptAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_1fr_auto]">
              <input type="hidden" name="back" value={q('charges')} />
              <div><Label htmlFor="m-tx">{t('match.tx')}</Label><Select id="m-tx" name="bankTransactionId" required>{incoming.map((x) => (<option key={x.id} value={x.id}>{fmtDate(x.bookingDate)} · {x.counterpartyName} · {fmtRate(x.remainingMinor, x.currency)}</option>))}</Select></div>
              <div><Label htmlFor="m-ch">{t('match.charge')}</Label><Select id="m-ch" name="houseChargeId" required>{openCharges.map((c) => (<option key={c.id} value={c.id}>{c.number} · {c.unitNo} · {c.ownerName} · {ym(c.periodStart)} · {fmtRate(c.outstandingMinor, c.currency)}</option>))}</Select></div>
              <div><Label htmlFor="m-am">{t('match.amount')}</Label><Input id="m-am" name="amount" type="number" min="1" step="1" placeholder={t('match.amountHint')} /></div>
              <div className="self-end"><Button type="submit" disabled={openCharges.length === 0}>{t('match.submit')}</Button></div>
            </form>
          )}
        </Card>
      ) : null}
      {rows.length === 0 ? <EmptyState icon={<Coins />} text={t('charges.empty')} /> : (
        <Table>
          <thead><tr><Th>{t('charges.number')}</Th><Th>{t('charges.unit')}</Th><Th>{t('charges.owner')}</Th><Th>{t('charges.period')}</Th><Th className="text-right">{t('charges.area')}</Th><Th>{t('charges.dueAt')}</Th><Th className="text-right">{t('charges.amount')}</Th><Th className="text-right">{t('charges.received')}</Th><Th className="text-right">{t('charges.outstanding')}</Th><Th>{t('charges.status')}</Th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={cn(c.status === 'OVERDUE' ? 'bg-red-50/40' : '')}>
                <Td className="font-mono text-xs font-semibold text-gray-700">{c.number}</Td>
                <Td><Link href={`/property/units/${c.unitId}`} className="font-mono font-semibold text-ink-900 hover:text-brand-600">{c.unitNo}</Link></Td>
                <Td className="text-gray-800">{c.ownerName}</Td>
                <Td className="font-mono text-xs text-gray-600">{ym(c.periodStart)}</Td>
                <Td className="text-right font-mono text-xs">{Number(c.areaM2)}{c.preCadastre ? <span className="ml-1 text-amber-600" title={t('charges.preCadastre')}>*</span> : null}</Td>
                <Td className={cn('font-mono text-xs', c.status === 'OVERDUE' ? 'font-semibold text-red-600' : 'text-gray-600')}>{fmtDate(c.dueAt)}{c.daysOverdue ? ` · ${t('charges.days', { n: c.daysOverdue })}` : ''}</Td>
                <Td className="text-right font-mono">{fmtRate(c.amountMinor, cur)}</Td>
                <Td className="text-right font-mono text-emerald-600">{fmtRate(c.receivedMinor, cur)}</Td>
                <Td className={cn('text-right font-mono font-semibold', c.outstandingMinor > 0n ? 'text-gray-900' : 'text-gray-400')}>{fmtRate(c.outstandingMinor, cur)}</Td>
                <Td><Badge tone={HOUSE_TONE[c.status]} dot>{t(`status.${c.status}`)}</Badge>{c.paidAt ? <span className="ml-1 font-mono text-[10px] text-gray-400">{fmtDate(c.paidAt)}</span> : null}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="text-[11px] text-gray-400">{t('charges.preCadastreHint')}</p>
      {page > 1 || hasNext ? (
        <div className="flex items-center justify-between text-sm text-gray-600">
          {page > 1 ? <Link href={q('charges', `&page=${page - 1}`)} className="rounded-md bg-gray-100 px-3 py-1.5 hover:bg-gray-200">← {t('prevPage')}</Link> : <span />}
          <span className="font-mono text-xs text-gray-400">{t('pageN', { n: page })}</span>
          {hasNext ? <Link href={q('charges', `&page=${page + 1}`)} className="rounded-md bg-gray-100 px-3 py-1.5 hover:bg-gray-200">{t('nextPage')} →</Link> : <span />}
        </div>
      ) : null}
    </>
  );
}

async function ReportView({ ctx, fundId, cur, period, q, t }: { ctx: Ctx; fundId: string; cur: string; period: string; q: (v: View, extra?: string) => string; t: T }) {
  const r = await getTransparencyReport(ctx, fundId, period);
  const [y, m] = period.split('-').map(Number);
  const shift = (k: number) => { const d = new Date(Date.UTC(y!, m! - 1 + k, 1)); return ym(d); };
  return (
    <>
      <div className="flex items-center gap-3 text-sm">
        <Link href={q('report', `&period=${shift(-1)}`)} className="rounded-md bg-gray-100 px-3 py-1.5 hover:bg-gray-200">←</Link>
        <span className="font-mono font-semibold">{period}</span>
        <Link href={q('report', `&period=${shift(1)}`)} className="rounded-md bg-gray-100 px-3 py-1.5 hover:bg-gray-200">→</Link>
        <span className="text-xs text-gray-400">{t('report.hint')}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Coins className="h-4 w-4 text-brand-500" />{t('report.money')}</h3>
          <dl className="mt-3 space-y-1.5 text-sm">
            {([['charged', r.money.chargedMinor], ['collected', r.money.collectedMinor], ['outstanding', r.money.outstandingMinor], ['spent', r.money.spentMinor]] as const).map(([k, v]) => (<div key={k} className="flex justify-between"><dt className="text-gray-500">{t(`money.${k}`)}</dt><dd className="font-mono">{fmtRate(v, cur)}</dd></div>))}
            <div className="flex justify-between"><dt className="text-gray-500">{t('money.collection')}</dt><dd className="font-mono">{r.money.collectionPct == null ? '—' : `${r.money.collectionPct}%`}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">{t('money.fee')}</dt><dd className="font-mono">{r.money.managementFeeMinor == null ? t('fund.feeOpen') : fmtRate(r.money.managementFeeMinor, cur)}</dd></div>
          </dl>
          <h4 className="mt-4 text-xs font-semibold text-gray-700">{t('report.budgetMonth')}</h4>
          <ul className="mt-1 space-y-0.5 text-xs">{r.money.budget.map((l) => (<li key={l.category} className="flex justify-between"><span className="text-gray-500">{t(`cat.${l.category}`)}</span><span className="font-mono">{fmtRate(l.actualMinor, cur)} / {fmtRate(l.plannedMinor, cur)}</span></li>))}</ul>
        </Card>
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><ClipboardList className="h-4 w-4 text-brand-500" />{t('report.works')}</h3>
          {r.works.done.length === 0 ? <p className="mt-2 text-sm text-gray-400">{t('report.noWorks')}</p> : <ul className="mt-2 space-y-1 text-sm">{r.works.done.map((w, i) => (<li key={i} className="flex justify-between gap-2"><span className="text-gray-800">{w.title}<span className="ml-2 text-xs text-gray-500">{w.contractorName ?? ''}</span></span><Badge tone={w.onTime ? 'green' : 'red'}>{w.onTime ? t('report.onTime') : t('report.late')}</Badge></li>))}</ul>}
          {r.works.expenses.length ? <ul className="mt-3 space-y-0.5 border-t border-gray-100 pt-2 text-xs">{r.works.expenses.map((e, i) => (<li key={i} className="flex justify-between"><span className="text-gray-600">{fmtDate(e.date)} · {e.contractorName} · {e.description}</span><span className="font-mono">{fmtRate(e.amountMinor, cur)}</span></li>))}</ul> : null}
        </Card>
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Scale className="h-4 w-4 text-brand-500" />{t('report.quality')}</h3>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <Stat v={r.quality.slaPct == null ? '—' : `${r.quality.slaPct}%`} k={t('report.sla')} />
            <Stat v={String(r.quality.doneCount)} k={t('report.done')} />
            <Stat v={String(r.quality.incidents)} k={t('report.incidents')} tone={r.quality.incidents ? 'text-red-600' : undefined} />
          </div>
        </Card>
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><FileText className="h-4 w-4 text-brand-500" />{t('report.next')}</h3>
          <p className="mt-2 text-xs text-gray-500">{t('report.openWorks', { n: r.works.open })}</p>
          {r.next.openWorkOrders.length ? <ul className="mt-1 list-inside list-disc text-sm text-gray-800">{r.next.openWorkOrders.map((w, i) => (<li key={i}>{w}</li>))}</ul> : null}
          {r.next.decisionsNeeded.length ? <ul className="mt-2 space-y-1 text-sm text-amber-700">{r.next.decisionsNeeded.map((d, i) => (<li key={i}>• {d}</li>))}</ul> : null}
          {!r.next.tariffApproved ? <p className="mt-2 text-xs text-amber-700">{t('tariffNotApproved')}</p> : null}
        </Card>
      </div>
    </>
  );
}
