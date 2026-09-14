import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, formatMoney, money } from '@finance-os/core';
import { listTaxObligations, listTaxRules } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, PageHeader, Select, StatCard, Table, Td, Th } from '@/components/ui';
import {
  approveTaxAction,
  calculateTaxAction,
  createTaxPaymentAction,
  fileTaxAction,
  upsertTaxRuleAction,
} from './actions';

const TONE = {
  PLANNED: 'gray',
  CALCULATED: 'blue',
  APPROVED: 'green',
  PAID: 'green',
  FILED: 'green',
  OVERDUE: 'red',
} as const;

export default async function TaxPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'payment.view')) notFound();
  const t = await getTranslations('tax');

  const [obligations, rules] = await Promise.all([listTaxObligations(ctx), listTaxRules(ctx)]);
  const open = obligations.filter((o) => !['FILED'].includes(o.status));
  const overdue = open.filter((o) => o.status === 'OVERDUE');
  const next3 = open.filter((o) => o.status !== 'OVERDUE').slice(0, 3);
  const canCalc = can(ctx, 'tax.calculate');
  const canApprove = can(ctx, 'tax.approve');
  const canFile = can(ctx, 'tax.file');
  const canPay = can(ctx, 'payment.create');

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />

      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t('open')} value={open.length} tone={open.length > 0 ? 'warning' : 'success'} />
        <StatCard label={t('overdueCount')} value={overdue.length} tone={overdue.length > 0 ? 'danger' : 'success'} />
        <StatCard
          label={t('nextDeadline')}
          value={next3[0] ? next3[0].dueDate.toISOString().slice(5, 10) : '—'}
          {...(next3[0] ? { hint: `${next3[0].name} · ${next3[0].period}` } : {})}
        />
      </div>

      <Table>
        <thead>
          <tr>
            <Th>{t('tax')}</Th>
            <Th>{t('period')}</Th>
            <Th>{t('due')}</Th>
            <Th className="text-right">{t('expected')}</Th>
            <Th className="text-right">{t('calculated')}</Th>
            <Th>{t('statusLabel')}</Th>
            <Th>{t('actions')}</Th>
          </tr>
        </thead>
        <tbody>
          {open.map((o) => (
            <tr key={o.id} className={o.status === 'OVERDUE' ? 'bg-red-50/60' : undefined}>
              <Td className="font-medium">{o.name}</Td>
              <Td className="font-mono text-xs">{o.period}</Td>
              <Td>{o.dueDate.toISOString().slice(0, 10)}</Td>
              <Td className="money text-right text-xs text-gray-500">
                {o.expectedMinMinor != null && o.expectedMaxMinor != null
                  ? `${formatMoney(money(o.expectedMinMinor, 'UZS'))} – ${formatMoney(money(o.expectedMaxMinor, 'UZS'))}`
                  : '—'}
              </Td>
              <Td className="money text-right">{o.calculatedMinor != null ? formatMoney(money(o.calculatedMinor, 'UZS')) : '—'}</Td>
              <Td>
                <Badge tone={TONE[o.status]}>{t(`status.${o.status}`)}</Badge>
              </Td>
              <Td>
                <div className="flex flex-wrap items-center gap-1.5">
                  {['PLANNED', 'CALCULATED', 'OVERDUE'].includes(o.status) && canCalc ? (
                    <form action={calculateTaxAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={o.id} />
                      <Input name="amount" type="number" min="1" placeholder={t('amountSoum')} required className="w-28 text-xs" />
                      <Button type="submit" variant="outline" size="sm">
                        {t('calculate')}
                      </Button>
                    </form>
                  ) : null}
                  {o.status === 'CALCULATED' && canApprove ? (
                    <form action={approveTaxAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <Button type="submit" size="sm">
                        {t('approve')}
                      </Button>
                    </form>
                  ) : null}
                  {o.status === 'APPROVED' && !o.paymentRequestId && canPay ? (
                    <form action={createTaxPaymentAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <Button type="submit" variant="dark" size="sm">
                        {t('createPayment')}
                      </Button>
                    </form>
                  ) : null}
                  {o.paymentRequestId && !['PAID', 'FILED'].includes(o.status) ? <Badge tone="blue">{t('paymentCreated')}</Badge> : null}
                  {o.status === 'PAID' && canFile ? (
                    <form action={fileTaxAction}>
                      <input type="hidden" name="id" value={o.id} />
                      <Button type="submit" variant="outline" size="sm">
                        {t('file')}
                      </Button>
                    </form>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {/* Правила (Lead/Owner) */}
      {canApprove ? (
        <Card title={t('rulesTitle')}>
          <ul className="mb-3 space-y-1 text-sm">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-2">
                <Badge tone="gray">{rule.type}</Badge>
                {rule.name} · {t('everyDay', { day: rule.dueDay })} ({t(`recurrence.${rule.recurrence}`)})
              </li>
            ))}
          </ul>
          <form action={upsertTaxRuleAction} className="flex flex-wrap items-end gap-2">
            <Select name="type" className="w-auto">
              {['VAT', 'PROFIT', 'PAYROLL_TAX', 'SOCIAL', 'PROPERTY', 'OTHER'].map((tp) => (
                <option key={tp} value={tp}>
                  {tp}
                </option>
              ))}
            </Select>
            <Input name="name" placeholder={t('ruleName')} required className="w-44" />
            <Select name="recurrence" className="w-auto">
              <option value="MONTHLY">{t('recurrence.MONTHLY')}</option>
              <option value="QUARTERLY">{t('recurrence.QUARTERLY')}</option>
              <option value="YEARLY">{t('recurrence.YEARLY')}</option>
            </Select>
            <Input name="dueDay" type="number" min="1" max="28" defaultValue="20" className="w-20" aria-label={t('dueDay')} />
            <Input name="expectedMin" type="number" min="0" placeholder={t('expectedMin')} className="w-32" />
            <Input name="expectedMax" type="number" min="0" placeholder={t('expectedMax')} className="w-32" />
            <Button type="submit">{t('addRule')}</Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
