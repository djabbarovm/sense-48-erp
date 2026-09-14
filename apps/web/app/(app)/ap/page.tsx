import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, formatMoney, money } from '@finance-os/core';
import { AP_BUCKETS, getApAging, listVendors } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, EmptyState, PageHeader, StatCard, Table, Td, Th } from '@/components/ui';
import { StatementForm } from './statement-form';

const BUCKET_TONE = { NOT_DUE: 'green', D1_7: 'yellow', D8_30: 'yellow', D31_60: 'red', D60_PLUS: 'red' } as const;

export default async function ApAgingPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'payment.view')) notFound();
  const t = await getTranslations('ap');

  const [rows, vendors] = await Promise.all([getApAging(ctx), listVendors(ctx)]);
  const totals = { NOT_DUE: 0n, D1_7: 0n, D8_30: 0n, D31_60: 0n, D60_PLUS: 0n };
  let grand = 0n;
  for (const row of rows) {
    for (const b of AP_BUCKETS) totals[b] += row.buckets[b];
    grand += row.totalMinor;
  }
  const overdue = totals.D1_7 + totals.D8_30 + totals.D31_60 + totals.D60_PLUS;

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />

      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t('totalAp')} value={formatMoney(money(grand, 'UZS'))} />
        <StatCard
          label={t('overdue')}
          value={formatMoney(money(overdue, 'UZS'))}
          tone={totals.D60_PLUS > 0n ? 'danger' : overdue > 0n ? 'warning' : 'success'}
        />
        <StatCard label={t('critical')} value={formatMoney(money(totals.D60_PLUS, 'UZS'))} tone={totals.D60_PLUS > 0n ? 'danger' : 'default'} />
      </div>

      <Table>
        <thead>
          <tr>
            <Th>{t('vendor')}</Th>
            {AP_BUCKETS.map((b) => (
              <Th key={b} className="text-right">
                {t(`bucket.${b}`)}
              </Th>
            ))}
            <Th className="text-right">{t('total')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.vendorId}>
              <Td>
                <details>
                  <summary className="cursor-pointer font-medium">{row.vendorName}</summary>
                  <ul className="mt-1.5 space-y-1 text-xs text-gray-600">
                    {row.invoices.map((inv) => (
                      <li key={inv.invoiceId} className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold">№{inv.number}</span>
                        <span>
                          {t('due')} {inv.dueDate.toISOString().slice(0, 10)}
                        </span>
                        <span className="money">{formatMoney(money(inv.outstandingMinor, 'UZS'))}</span>
                        <Badge tone={BUCKET_TONE[inv.bucket]}>{t(`bucket.${inv.bucket}`)}</Badge>
                        {inv.disputed ? <Badge tone="red">{t('disputed')}</Badge> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              </Td>
              {AP_BUCKETS.map((b) => (
                <Td key={b} className={`money text-right ${row.buckets[b] > 0n && (b === 'D31_60' || b === 'D60_PLUS') ? 'text-red-600' : ''}`}>
                  {row.buckets[b] > 0n ? formatMoney(money(row.buckets[b], 'UZS')) : '—'}
                </Td>
              ))}
              <Td className="money text-right font-semibold">{formatMoney(money(row.totalMinor, 'UZS'))}</Td>
            </tr>
          ))}
          {rows.length > 0 ? (
            <tr className="bg-gray-50/80">
              <Td className="font-semibold">{t('totalRow')}</Td>
              {AP_BUCKETS.map((b) => (
                <Td key={b} className="money text-right font-semibold">
                  {totals[b] > 0n ? formatMoney(money(totals[b], 'UZS')) : '—'}
                </Td>
              ))}
              <Td className="money text-right font-bold">{formatMoney(money(grand, 'UZS'))}</Td>
            </tr>
          ) : null}
        </tbody>
      </Table>
      {rows.length === 0 ? <EmptyState text={t('empty')} /> : null}

      <StatementForm vendors={vendors.map((v) => ({ id: v.id, name: v.displayName }))} />
    </div>
  );
}
