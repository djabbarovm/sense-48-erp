import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Award } from 'lucide-react';
import { can } from '@finance-os/core';
import { getBonusReport, listBonuses } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Table, Td, Th, cn } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';
import { markBonusesPaidAction } from './actions';
import { BONUS_TONE, COMMISSION_TONE } from '../commissions/tones';

/* P-14 — бонусы продажников (BR-P43/P44): отчёт за период, выплата финансами. */

export default async function BonusesPage({ searchParams }: { searchParams: Promise<{ period?: string; error?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'bonus.view') && !can(ctx, 'bonus.own')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('bonuses');
  const td = await getTranslations('deals');
  const now = new Date();
  const period = /^\d{4}-\d{2}$/.test(sp.period ?? '') ? sp.period! : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const [rows, report] = await Promise.all([listBonuses(ctx, { period }), getBonusReport(ctx, period)]);
  const payable = rows.filter((b) => b.status === 'PAYABLE');
  const cur = report.currency;

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} meta={<Badge tone="gray">{t('summary.deals', { n: report.totals.deals })}</Badge>} actions={<form className="flex items-end gap-2"><div><Label htmlFor="p">{t('period')}</Label><Input id="p" name="period" type="month" defaultValue={period} /></div><Button type="submit" variant="outline" size="sm">{t('apply')}</Button></form>} />
      {sp.error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : t('error.GENERIC')}</div> : null}
      {!can(ctx, 'bonus.view') ? <p className="text-xs text-gray-500">{t('ownHint')}</p> : null}
      <Card>
        <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-gray-400">{fmtRate(report.totals.potentialMinor, cur)}</p><p className="text-[11px] text-gray-500">{t('summary.potential')}</p></div>
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-brand-600">{fmtRate(report.totals.confirmedMinor, cur)}</p><p className="text-[11px] text-gray-500">{t('summary.confirmed')}</p></div>
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-amber-600">{fmtRate(report.totals.payableMinor, cur)}</p><p className="text-[11px] text-gray-500">{t('summary.payable')}</p></div>
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-emerald-600">{fmtRate(report.totals.paidMinor, cur)}</p><p className="text-[11px] text-gray-500">{t('summary.paid')}</p></div>
          <div><p className="font-mono text-base font-bold whitespace-nowrap text-red-600">{fmtRate(report.totals.withheldMinor, cur)}</p><p className="text-[11px] text-gray-500">{t('summary.withheld')}</p></div>
        </div>
        {report.lines.length > 1 ? (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="text-[11px] font-semibold tracking-wider text-gray-400 uppercase">{t('byEmployee')}</p>
            <ul className="mt-1 divide-y divide-gray-100 text-sm">{report.lines.map((l) => (<li key={l.employeeId} className="flex items-center justify-between gap-2 py-1.5"><span className="font-medium text-gray-900">{l.employeeName}<span className="ml-2 text-xs text-gray-500">{t('summary.deals', { n: l.deals })}</span></span><span className="font-mono text-xs"><span className="text-amber-600">{fmtRate(l.payableMinor, cur)}</span> · <span className="text-emerald-600">{fmtRate(l.paidMinor, cur)}</span></span></li>))}</ul>
          </div>
        ) : null}
      </Card>
      {rows.length === 0 ? <EmptyState icon={<Award />} text={t('empty')} /> : (
        <form action={markBonusesPaidAction} className="space-y-3">
          <input type="hidden" name="period" value={period} />
          <Table>
            <thead><tr>{can(ctx, 'bonus.pay') ? <Th /> : null}<Th>{t('fields.employee')}</Th><Th>{t('fields.deal')}</Th><Th>{t('fields.product')}</Th><Th>{t('fields.kind')}</Th><Th className="text-right">{t('fields.amount')}</Th><Th>{t('fields.status')}</Th><Th>{t('fields.commission')}</Th><Th>{t('fields.payout')}</Th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  {can(ctx, 'bonus.pay') ? <Td>{b.status === 'PAYABLE' ? <input type="checkbox" name="ids" value={b.id} className="h-4 w-4" aria-label={b.id} /> : null}</Td> : null}
                  <Td className="font-medium text-gray-900">{b.employeeName}</Td>
                  <Td><Link href={`/deals/${b.dealId}`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">{b.dealNumber}</Link>{b.unitNo ? <span className="ml-2 font-mono text-xs text-gray-500">{b.unitNo}</span> : null}</Td>
                  <Td className="text-xs">{td(`product.${b.product}`)}</Td>
                  <Td className="text-xs">{td(`bonusKind.${b.kind}`)} · {b.rateBp / 100}%{b.kind === 'KPI' && b.kpiDeadline ? <p className="text-[10px] text-gray-400">{t('fields.deadline')} {fmtDate(b.kpiDeadline)}</p> : null}</Td>
                  <Td className={cn('text-right font-mono', b.status === 'WITHHELD' ? 'text-gray-400 line-through' : 'text-gray-900')}>{fmtRate(b.amountMinor, b.currency)}</Td>
                  <Td><Badge tone={BONUS_TONE[b.status]} dot>{td(`bonusStatus.${b.status}`)}</Badge>{b.withheldReason ? <p className="text-[10px] text-gray-400">{td.has(`error.${b.withheldReason}`) ? td(`error.${b.withheldReason as never}`) : b.withheldReason}</p> : null}</Td>
                  <Td><Badge tone={COMMISSION_TONE[b.commissionStatus]}>{td(`commissionStatus.${b.commissionStatus}`)}</Badge></Td>
                  <Td className="font-mono text-xs text-gray-600">{b.paidAt ? `${b.payoutPeriod ?? ''}${b.payoutRef ? ` · ${b.payoutRef}` : ''} · ${fmtDate(b.paidAt)}` : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {can(ctx, 'bonus.pay') && payable.length ? (
            <Card>
              <h3 className="font-display text-sm font-semibold">{t('pay.title')}</h3>
              <p className="mt-1 text-xs text-gray-500">{t('pay.hint')} {t('pay.selectHint')}</p>
              <div className="mt-2 flex flex-wrap items-end gap-2"><div><Label htmlFor="ref">{t('pay.ref')}</Label><Input id="ref" name="ref" /></div><Button type="submit" size="sm">{t('pay.submit')}</Button></div>
            </Card>
          ) : null}
        </form>
      )}
    </div>
  );
}
