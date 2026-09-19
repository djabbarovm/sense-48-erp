import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, BadgePercent, Landmark } from 'lucide-react';
import { can } from '@finance-os/core';
import { listCommissions, listUnmatchedIncoming } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Table, Td, Th, cn } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';
import { matchCommissionReceiptAction } from './actions';
import { COMMISSION_TONE } from './tones';

/* P-14 — комиссии ORDO по продуктам (BR-P41), PAID только по банку (BR-P42). */

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ view?: string; error?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'commission.view')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('commissions');
  const td = await getTranslations('deals');
  const view = sp.view ?? 'open';
  const status = view === 'paid' ? ['PAID' as const] : view === 'cancelled' ? ['CANCELLED' as const] : view === 'all' ? undefined : ['ACCRUED' as const, 'PARTIAL' as const];
  const [rows, all, incoming] = await Promise.all([listCommissions(ctx, status ? { status } : {}), listCommissions(ctx), can(ctx, 'rent.match') ? listUnmatchedIncoming(ctx) : Promise.resolve([])]);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const open = all.filter((c) => c.status === 'ACCRUED' || c.status === 'PARTIAL');
  const cur = all[0]?.currency ?? 'USD';
  const sum = (xs: typeof all, f: (c: (typeof all)[number]) => bigint) => xs.reduce((a, c) => a + f(c), 0n);
  const tabs = ['open', 'paid', 'cancelled', 'all'] as const;

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} meta={<Badge tone="gray">{t('count', { n: rows.length })}</Badge>} actions={<div className="flex flex-wrap gap-1.5">{tabs.map((v) => (<Link key={v} href={`/commissions?view=${v}`} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', view === v ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>{t(`tab.${v}`)}</Link>))}</div>} />
      {sp.error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : t('error.GENERIC')}</div> : null}
      <Card>
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><BadgePercent className="h-4 w-4 text-brand-500" />{t('summary.accrued')}</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-900">{fmtRate(sum(open, (c) => c.outstandingMinor), cur)}</p><p className="text-[11px] text-gray-500">{t('summary.accrued')}</p></div>
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-emerald-600">{fmtRate(sum(all.filter((c) => c.paidAt && c.paidAt >= monthStart), (c) => c.receivedMinor), cur)}</p><p className="text-[11px] text-gray-500">{t('summary.received')}</p></div>
          <div><p className={cn('font-mono text-base font-bold whitespace-nowrap', open.some((c) => c.dueAt < now) ? 'text-red-600' : 'text-gray-400')}>{fmtRate(sum(open.filter((c) => c.dueAt < now), (c) => c.outstandingMinor), cur)}</p><p className="text-[11px] text-gray-500">{t('summary.overdue')}</p></div>
          <div><p className="font-mono text-base font-bold text-gray-500">{all.filter((c) => c.status === 'CANCELLED').length}</p><p className="text-[11px] text-gray-500">{t('summary.cancelled')}</p></div>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">{t('rulesHint')}</p>
      </Card>
      {can(ctx, 'rent.match') ? (
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Landmark className="h-4 w-4 text-brand-500" />{t('match.title')}</h3>
          <p className="mt-1 text-xs text-gray-500">{t('match.hint')}</p>
          {incoming.length === 0 || open.length === 0 ? <p className="mt-2 text-sm text-gray-400">{t('match.noTx')}</p> : (
            <form action={matchCommissionReceiptAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_2fr_1fr_auto]">
              <input type="hidden" name="back" value={`/commissions?view=${view}`} />
              <div><Label htmlFor="m-tx">{t('match.tx')}</Label><Select id="m-tx" name="bankTransactionId" required>{incoming.map((x) => (<option key={x.id} value={x.id}>{fmtDate(x.bookingDate)} · {x.counterpartyName} · {fmtRate(x.remainingMinor, x.currency)}</option>))}</Select></div>
              <div><Label htmlFor="m-c">{t('match.commission')}</Label><Select id="m-c" name="commissionId" required>{open.map((c) => (<option key={c.id} value={c.id}>{c.number} · {c.dealNumber} · {c.payerName} · {fmtRate(c.outstandingMinor, c.currency)}</option>))}</Select></div>
              <div><Label htmlFor="m-amount">{t('match.amount')}</Label><Input id="m-amount" name="amount" type="number" min="0.01" step="0.01" /></div>
              <div className="self-end"><Button type="submit">{t('match.submit')}</Button></div>
            </form>
          )}
        </Card>
      ) : null}
      {rows.length === 0 ? <EmptyState icon={<BadgePercent />} text={t('empty')} /> : (
        <Table>
          <thead><tr><Th>{t('fields.number')}</Th><Th>{t('fields.deal')}</Th><Th>{t('fields.product')}</Th><Th>{t('fields.payer')}</Th><Th className="text-right">{t('fields.base')}</Th><Th className="text-right">{t('fields.amount')}</Th><Th className="text-right">{t('fields.received')}</Th><Th>{t('fields.due')}</Th><Th>{t('fields.status')}</Th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={cn(c.status !== 'PAID' && c.status !== 'CANCELLED' && c.dueAt < now ? 'bg-red-50/40' : '')}>
                <Td className="font-mono text-xs font-semibold text-gray-700">{c.number}</Td>
                <Td><Link href={`/deals/${c.dealId}`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">{c.dealNumber}</Link>{c.unitNo ? <span className="ml-2 font-mono text-xs text-gray-500">{c.unitNo}</span> : null}<span className="ml-2 text-xs text-gray-500">{c.managerName}</span></Td>
                <Td className="text-xs">{td(`product.${c.product}`)}</Td>
                <Td className="text-xs"><span className="text-gray-900">{c.payerName}</span><span className="ml-1 text-gray-400">({td(`payer.${c.payer}`)})</span>{c.externalBrokerName ? <p className="text-[10px] text-gray-400">{t('fields.broker', { name: c.externalBrokerName, pct: c.externalShareBp / 100 })}</p> : null}</Td>
                <Td className="text-right font-mono text-xs text-gray-600">{fmtRate(c.baseMinor, c.currency)} · {c.rateBp / 100}%</Td>
                <Td className="text-right font-mono">{fmtRate(c.amountMinor, c.currency)}{c.netMinor !== c.amountMinor ? <p className="text-[10px] text-gray-400">{t('fields.net')} {fmtRate(c.netMinor, c.currency)}</p> : null}</Td>
                <Td className="text-right font-mono text-emerald-600">{fmtRate(c.receivedMinor, c.currency)}</Td>
                <Td className="font-mono text-xs text-gray-600">{fmtDate(c.dueAt)}</Td>
                <Td><Badge tone={COMMISSION_TONE[c.status]} dot>{td(`commissionStatus.${c.status}`)}</Badge>{c.cancelReason ? <p className="text-[10px] text-gray-400">{c.cancelReason}</p> : null}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
