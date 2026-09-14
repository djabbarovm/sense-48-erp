import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, formatMoney, money } from '@finance-os/core';
import { AP_BUCKETS, getArAging, listCustomerInvoices, prisma } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, StatCard, Table, Td, Th } from '@/components/ui';
import { createArInvoiceAction, disputeArAction, issueArAction, promiseArAction } from './actions';

const STATUS_TONE = {
  DRAFT: 'gray',
  ISSUED: 'blue',
  PARTIALLY_PAID: 'blue',
  PAID: 'green',
  OVERDUE: 'red',
  DISPUTED: 'yellow',
  CANCELLED: 'gray',
} as const;

export default async function ArPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'payment.view')) notFound();
  const t = await getTranslations('ar');

  const [aging, drafts, customers] = await Promise.all([
    getArAging(ctx),
    listCustomerInvoices(ctx, { status: ['DRAFT'] }),
    prisma.customer.findMany({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' }, orderBy: { legalName: 'asc' } }),
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.legalName]));
  const canManage = can(ctx, 'ar.invoice.manage');
  const canDispute = can(ctx, 'ar.dispute');

  const totals = { NOT_DUE: 0n, D1_7: 0n, D8_30: 0n, D31_60: 0n, D60_PLUS: 0n };
  let grand = 0n;
  for (const row of aging) {
    for (const b of AP_BUCKETS) totals[b] += row.buckets[b];
    grand += row.totalMinor;
  }
  const overdue = totals.D1_7 + totals.D8_30 + totals.D31_60 + totals.D60_PLUS;

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />

      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t('totalAr')} value={formatMoney(money(grand, 'UZS'))} />
        <StatCard label={t('overdue')} value={formatMoney(money(overdue, 'UZS'))} tone={overdue > 0n ? 'warning' : 'success'} />
        <StatCard label={t('critical')} value={formatMoney(money(totals.D60_PLUS, 'UZS'))} tone={totals.D60_PLUS > 0n ? 'danger' : 'default'} />
      </div>

      {canManage && customers.length > 0 ? (
        <Card title={t('newInvoice')}>
          <form action={createArInvoiceAction} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-5">
            <div className="sm:col-span-2">
              <Label htmlFor="ar-customer">{t('customer')}</Label>
              <Select id="ar-customer" name="customerId" required>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.legalName}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ar-date">{t('date')}</Label>
              <Input id="ar-date" name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
            </div>
            <div>
              <Label htmlFor="ar-amount">{t('amountSoum')}</Label>
              <Input id="ar-amount" name="amount" type="number" min="1" required />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="issue" defaultChecked className="h-4 w-4 accent-volt-600" /> {t('issueNow')}
              </label>
              <Button type="submit">{t('create')}</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {drafts.length > 0 ? (
        <Card title={t('drafts')}>
          <ul className="space-y-2">
            {drafts.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2 text-sm">
                <span>
                  <span className="font-mono text-xs font-semibold">{inv.number}</span> · {customerName.get(inv.customerId) ?? '—'} ·{' '}
                  <span className="money">{formatMoney(money(inv.amountGrossMinor, inv.currency))}</span>
                </span>
                {canManage ? (
                  <form action={issueArAction}>
                    <input type="hidden" name="id" value={inv.id} />
                    <Button type="submit" variant="outline" size="sm">
                      {t('issue')}
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Table>
        <thead>
          <tr>
            <Th>{t('customer')}</Th>
            {AP_BUCKETS.map((b) => (
              <Th key={b} className="text-right">
                {t(`bucket.${b}`)}
              </Th>
            ))}
            <Th className="text-right">{t('total')}</Th>
          </tr>
        </thead>
        <tbody>
          {aging.map((row) => (
            <tr key={row.customerId}>
              <Td>
                <details>
                  <summary className="cursor-pointer font-medium">{row.customerName}</summary>
                  <ul className="mt-1.5 space-y-1.5 text-xs text-gray-600">
                    {row.invoices.map((inv) => (
                      <li key={inv.invoiceId} className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold">{inv.number}</span>
                        <span>
                          {t('due')} {inv.dueDate.toISOString().slice(0, 10)}
                        </span>
                        <span className="money">{formatMoney(money(inv.outstandingMinor, 'UZS'))}</span>
                        <Badge tone={STATUS_TONE[inv.status]}>{t(`status.${inv.status}`)}</Badge>
                        {inv.promiseToPayDate ? (
                          <Badge tone="blue">
                            {t('promise')} {inv.promiseToPayDate.toISOString().slice(0, 10)}
                          </Badge>
                        ) : null}
                        {canManage ? (
                          <form action={promiseArAction} className="flex items-center gap-1">
                            <input type="hidden" name="id" value={inv.invoiceId} />
                            <Input name="date" type="date" required className="w-32 text-xs" />
                            <Button type="submit" variant="ghost" size="sm">
                              {t('setPromise')}
                            </Button>
                          </form>
                        ) : null}
                        {canDispute && inv.status !== 'DISPUTED' ? (
                          <form action={disputeArAction} className="flex items-center gap-1">
                            <input type="hidden" name="id" value={inv.invoiceId} />
                            <Input name="reason" placeholder={t('disputeReason')} required className="w-36 text-xs" />
                            <Button type="submit" variant="ghost" size="sm">
                              {t('dispute')}
                            </Button>
                          </form>
                        ) : null}
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
        </tbody>
      </Table>
      {aging.length === 0 ? <EmptyState text={t('empty')} /> : null}
      <p className="text-xs text-gray-400">{t('bucketNote')}</p>
    </div>
  );
}
