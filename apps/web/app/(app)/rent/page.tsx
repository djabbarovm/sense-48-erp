import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Coins, Landmark } from 'lucide-react';
import { can } from '@finance-os/core';
import { getReceivablesSummary, listRentCharges, listUnmatchedIncoming } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Table, Td, Th, cn } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';
import { matchRentReceiptAction } from './actions';
import { RENT_TONE } from './tones';

/* Аренда и дебиторка (blueprint §1.7 Finance, §9 Finance): начисления, просрочка, зачёт банковских поступлений (BR-P37). */

const period = (c: { periodStart: Date; periodEnd: Date; prorated: boolean }) => `${fmtDate(c.periodStart)} → ${fmtDate(c.periodEnd)}`;

export default async function RentPage({ searchParams }: { searchParams: Promise<{ view?: string; error?: string; unit?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'rent.view')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('rent');
  const view = sp.view ?? 'open';
  const status = view === 'overdue' ? ['OVERDUE' as const] : view === 'paid' ? ['PAID' as const, 'WAIVED' as const] : view === 'all' ? undefined : ['DUE' as const, 'PARTIAL' as const, 'OVERDUE' as const];
  const [rows, summary, incoming] = await Promise.all([
    listRentCharges(ctx, { ...(status ? { status } : {}), ...(sp.unit ? { unitId: sp.unit } : {}) }),
    getReceivablesSummary(ctx),
    can(ctx, 'rent.match') ? listUnmatchedIncoming(ctx) : Promise.resolve([]),
  ]);
  const openCharges = rows.filter((r) => ['DUE', 'PARTIAL', 'OVERDUE'].includes(r.status));
  const tabs = ['open', 'overdue', 'paid', 'all'] as const;
  const cur = summary.currency;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        meta={<span className="flex items-center gap-2"><Badge tone="gray">{t('count', { n: rows.length })}</Badge>{summary.overdueCount ? <Badge tone="red" dot>{t('overdueCount', { n: summary.overdueCount })}</Badge> : null}</span>}
        actions={<div className="flex flex-wrap gap-1.5">{tabs.map((v) => (<Link key={v} href={`/rent?view=${v}`} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', view === v ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>{t(`tab.${v}`)}</Link>))}</div>}
      />
      {sp.error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : t('error.GENERIC')}</div> : null}

      <Card>
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Coins className="h-4 w-4 text-brand-500" />{t('summary.outstanding')}</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-3 lg:grid-cols-6">
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-900">{fmtRate(summary.outstandingMinor, cur)}</p><p className="text-[11px] text-gray-500">{t('summary.outstanding')}</p></div>
          <div><p className={cn('font-mono text-base font-bold whitespace-nowrap', summary.overdueMinor > 0n ? 'text-red-600' : 'text-gray-400')}>{fmtRate(summary.overdueMinor, cur)}</p><p className="text-[11px] text-gray-500">{t('summary.overdue')}</p></div>
          <div><p className="font-mono text-base font-bold text-gray-900">{summary.debtorUnits}</p><p className="text-[11px] text-gray-500">{t('summary.debtors')}</p></div>
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-900">{fmtRate(summary.monthChargedMinor, cur)}</p><p className="text-[11px] text-gray-500">{t('summary.monthCharged')}</p></div>
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-emerald-600">{fmtRate(summary.monthReceivedMinor, cur)}</p><p className="text-[11px] text-gray-500">{t('summary.monthReceived')}</p></div>
          <div><p className={cn('font-mono text-base font-bold', summary.collectionPct != null && summary.collectionPct < 70 ? 'text-red-600' : 'text-gray-900')}>{summary.collectionPct == null ? t('summary.noData') : `${summary.collectionPct}%`}</p><p className="text-[11px] text-gray-500">{t('summary.collection')}</p></div>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">{t('generateHint')}</p>
      </Card>

      {can(ctx, 'rent.match') ? (
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Landmark className="h-4 w-4 text-brand-500" />{t('match.title')}</h3>
          <p className="mt-1 text-xs text-gray-500">{t('match.hint')}</p>
          {incoming.length === 0 ? <p className="mt-2 text-sm text-gray-400">{t('match.noTx')}</p> : (
            <form action={matchRentReceiptAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_1fr_auto]">
              <input type="hidden" name="back" value={`/rent?view=${view}`} />
              <div><Label htmlFor="m-tx">{t('match.tx')}</Label><Select id="m-tx" name="bankTransactionId" required>{incoming.map((x) => (<option key={x.id} value={x.id}>{fmtDate(x.bookingDate)} · {x.counterpartyName} · {fmtRate(x.amountMinor, x.currency)}{x.remainingMinor !== x.amountMinor ? ` (${t('match.remaining', { v: fmtRate(x.remainingMinor, x.currency) })})` : ''}</option>))}</Select></div>
              <div><Label htmlFor="m-charge">{t('match.charge')}</Label><Select id="m-charge" name="rentChargeId" required>{openCharges.map((c) => (<option key={c.id} value={c.id}>{c.number} · {c.unitNo} · {c.occupantName} · {period(c)} · {fmtRate(c.outstandingMinor, c.currency)}</option>))}</Select></div>
              <div><Label htmlFor="m-amount">{t('match.amount')}</Label><Input id="m-amount" name="amount" type="number" min="0.01" step="0.01" placeholder={t('match.amountHint')} /></div>
              <div className="self-end"><Button type="submit" disabled={openCharges.length === 0}>{t('match.submit')}</Button></div>
            </form>
          )}
        </Card>
      ) : null}

      {rows.length === 0 ? <EmptyState icon={<Coins />} text={t('empty')} /> : (
        <Table>
          <thead><tr><Th>{t('fields.number')}</Th><Th>{t('fields.unit')}</Th><Th>{t('fields.occupant')}</Th><Th>{t('fields.period')}</Th><Th>{t('fields.dueAt')}</Th><Th className="text-right">{t('fields.amount')}</Th><Th className="text-right">{t('fields.received')}</Th><Th className="text-right">{t('fields.outstanding')}</Th><Th>{t('fields.status')}</Th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={cn(c.status === 'OVERDUE' ? 'bg-red-50/40' : '')}>
                <Td className="font-mono text-xs font-semibold text-gray-700">{c.number}</Td>
                <Td><Link href={`/property/units/${c.unitId}`} className="font-mono font-semibold text-ink-900 hover:text-brand-600">{c.unitNo}</Link></Td>
                <Td className="text-gray-800">{c.occupantName}</Td>
                <Td className="font-mono text-xs text-gray-600">{period(c)}{c.prorated ? <span className="ml-1 text-gray-400">· {t('fields.prorated')}</span> : null}</Td>
                <Td className={cn('font-mono text-xs', c.status === 'OVERDUE' ? 'font-semibold text-red-600' : 'text-gray-600')}>{fmtDate(c.dueAt)}{c.daysOverdue ? ` · ${t('fields.daysOverdue', { n: c.daysOverdue })}` : ''}</Td>
                <Td className="text-right font-mono">{fmtRate(c.amountMinor, c.currency)}</Td>
                <Td className="text-right font-mono text-emerald-600">{fmtRate(c.receivedMinor, c.currency)}</Td>
                <Td className={cn('text-right font-mono font-semibold', c.outstandingMinor > 0n ? 'text-gray-900' : 'text-gray-400')}>{fmtRate(c.outstandingMinor, c.currency)}</Td>
                <Td><Badge tone={RENT_TONE[c.status]} dot>{t(`status.${c.status}`)}</Badge>{c.paidAt ? <span className="ml-1 font-mono text-[10px] text-gray-400">{fmtDate(c.paidAt)}</span> : null}{c.waivedReason ? <span className="ml-1 text-[10px] text-gray-400">{c.waivedReason}</span> : null}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
