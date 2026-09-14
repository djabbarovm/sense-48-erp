import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { TrendingUp } from 'lucide-react';
import { can, formatMoney, money } from '@finance-os/core';
import { getCashForecast, listCashPlanLines } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, PageHeader, Select, StatCard, Table, Td, Th } from '@/components/ui';
import { deletePlanLineAction, upsertPlanLineAction } from './actions';

export default async function ForecastPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'payment.view')) notFound();
  const t = await getTranslations('forecast');

  const [forecast, planLines] = await Promise.all([getCashForecast(ctx), listCashPlanLines(ctx)]);
  const minClosing = forecast.weeks.reduce((min, w) => (w.closingMinor < min ? w.closingMinor : min), forecast.openingMinor);
  const canManage = can(ctx, 'budget.manage');
  const fmt = (v: bigint) => formatMoney(money(v, 'UZS'));

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />

      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t('opening')} value={fmt(forecast.openingMinor)} />
        <StatCard
          label={t('minClosing')}
          value={fmt(minClosing)}
          tone={minClosing < 0n ? 'danger' : 'success'}
          {...(minClosing < 0n ? { hint: t('cashGapHint') } : {})}
        />
        <StatCard
          label={t('horizonClosing')}
          value={fmt(forecast.weeks[forecast.weeks.length - 1]?.closingMinor ?? 0n)}
          icon={<TrendingUp />}
        />
      </div>

      <Table>
        <thead>
          <tr>
            <Th>{t('week')}</Th>
            <Th className="text-right">{t('inAr')}</Th>
            <Th className="text-right">{t('inPlan')}</Th>
            <Th className="text-right">{t('outPayments')}</Th>
            <Th className="text-right">{t('outPr')}</Th>
            <Th className="text-right">{t('outPlan')}</Th>
            <Th className="text-right">{t('net')}</Th>
            <Th className="text-right">{t('closing')}</Th>
          </tr>
        </thead>
        <tbody>
          {forecast.weeks.map((week, i) => (
            <tr key={i} className={week.closingMinor < 0n ? 'bg-red-50/60' : undefined}>
              <Td className="font-medium">
                {t('weekN', { n: i + 1 })} · {week.weekStart.toISOString().slice(5, 10)}
              </Td>
              <Td className="money text-right text-volt-700">{week.inflowArMinor > 0n ? fmt(week.inflowArMinor) : '—'}</Td>
              <Td className="money text-right text-volt-700">{week.inflowPlanMinor > 0n ? fmt(week.inflowPlanMinor) : '—'}</Td>
              <Td className="money text-right">{week.outflowPaymentsMinor > 0n ? fmt(week.outflowPaymentsMinor) : '—'}</Td>
              <Td className="money text-right">{week.outflowPrMinor > 0n ? fmt(week.outflowPrMinor) : '—'}</Td>
              <Td className="money text-right">{week.outflowPlanMinor > 0n ? fmt(week.outflowPlanMinor) : '—'}</Td>
              <Td className={`money text-right ${week.netMinor < 0n ? 'text-red-600' : 'text-volt-700'}`}>{fmt(week.netMinor)}</Td>
              <Td className={`money text-right font-semibold ${week.closingMinor < 0n ? 'text-red-600' : ''}`}>{fmt(week.closingMinor)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <Card title={t('planTitle')}>
        <ul className="mb-3 space-y-1.5 text-sm">
          {planLines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <Badge tone={line.amountMinor < 0n ? 'red' : 'green'}>{t(`type.${line.type}`)}</Badge>
                {line.name}
                {line.recurrence === 'MONTHLY' ? <Badge tone="blue">{t('monthly')}</Badge> : null}
                <span className="text-xs text-gray-500">
                  {t('from')} {line.dueDate.toISOString().slice(0, 10)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="money">{fmt(line.amountMinor < 0n ? -line.amountMinor : line.amountMinor)}</span>
                {canManage ? (
                  <form action={deletePlanLineAction}>
                    <input type="hidden" name="id" value={line.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      ✕
                    </Button>
                  </form>
                ) : null}
              </span>
            </li>
          ))}
          {planLines.length === 0 ? <p className="text-gray-500">—</p> : null}
        </ul>
        {canManage ? (
          <form action={upsertPlanLineAction} className="flex flex-wrap items-end gap-2">
            <Input name="name" placeholder={t('lineName')} required className="w-48" />
            <Select name="type" className="w-auto">
              <option value="LOAN_REPAYMENT">{t('type.LOAN_REPAYMENT')}</option>
              <option value="CAPEX">{t('type.CAPEX')}</option>
              <option value="TAX">{t('type.TAX')}</option>
              <option value="PAYROLL">{t('type.PAYROLL')}</option>
              <option value="OTHER">{t('type.OTHER')}</option>
            </Select>
            <Select name="direction" className="w-auto">
              <option value="OUT">{t('outflow')}</option>
              <option value="IN">{t('inflow')}</option>
            </Select>
            <Input name="amount" type="number" min="1" placeholder={t('amountSoum')} required className="w-36" />
            <Input name="dueDate" type="date" required className="w-40" />
            <label className="flex items-center gap-1.5 pb-2 text-sm">
              <input type="checkbox" name="monthly" className="h-4 w-4 accent-volt-600" /> {t('monthly')}
            </label>
            <Button type="submit">{t('addLine')}</Button>
          </form>
        ) : null}
      </Card>
    </div>
  );
}
