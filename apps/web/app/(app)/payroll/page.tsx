import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, formatMoney, money } from '@finance-os/core';
import { listPayrollRuns } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, PageHeader, Table, Td, Th } from '@/components/ui';
import { PayrollCheckForm } from './check-form';
import { approvePayrollAction, createPayrollAction, createPayrollPaymentAction, markPostedAction } from './actions';

const TONE = { DRAFT: 'gray', CHECKED: 'blue', APPROVED: 'green', PAID: 'green', POSTED: 'green' } as const;

export default async function PayrollPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'payment.view')) notFound();
  const t = await getTranslations('payroll');

  const runs = await listPayrollRuns(ctx);
  const canPrepare = can(ctx, 'payroll.prepare');
  const canApprove = can(ctx, 'payroll.approve');
  const canPost = can(ctx, 'tax.file');
  const canPay = can(ctx, 'payment.create');
  const currentPeriod = new Date().toISOString().slice(0, 7);

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />
      <p className="-mt-3 max-w-3xl text-sm text-gray-500">{t('intro')}</p>

      {canPrepare ? (
        <Card title={t('newRun')}>
          <form action={createPayrollAction} className="flex flex-wrap items-end gap-2">
            <Input name="period" type="month" defaultValue={currentPeriod} required className="w-40" />
            <Input name="employeeCount" type="number" min="1" placeholder={t('employees')} required className="w-28" />
            <Input name="gross" type="number" min="1" placeholder={t('gross')} required className="w-36" />
            <Input name="net" type="number" min="1" placeholder={t('net')} required className="w-36" />
            <Input name="taxes" type="number" min="0" placeholder={t('taxes')} required className="w-36" />
            <Button type="submit">{t('create')}</Button>
          </form>
        </Card>
      ) : null}

      <Table>
        <thead>
          <tr>
            <Th>{t('period')}</Th>
            <Th className="text-right">{t('employees')}</Th>
            <Th className="text-right">{t('gross')}</Th>
            <Th className="text-right">{t('net')}</Th>
            <Th className="text-right">{t('taxes')}</Th>
            <Th>{t('statusLabel')}</Th>
            <Th>{t('actions')}</Th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <Td className="font-mono font-medium">{run.period}</Td>
              <Td className="tnum text-right">{run.employeeCount}</Td>
              <Td className="money text-right">{formatMoney(money(run.grossMinor, 'UZS'))}</Td>
              <Td className="money text-right">{formatMoney(money(run.netMinor, 'UZS'))}</Td>
              <Td className="money text-right">{formatMoney(money(run.taxesMinor, 'UZS'))}</Td>
              <Td>
                <Badge tone={TONE[run.status]}>{t(`status.${run.status}`)}</Badge>
              </Td>
              <Td>
                <div className="flex flex-col gap-1.5">
                  {run.status === 'DRAFT' && canPrepare ? <PayrollCheckForm runId={run.id} /> : null}
                  {run.status === 'CHECKED' && canApprove ? (
                    <form action={approvePayrollAction}>
                      <input type="hidden" name="id" value={run.id} />
                      <Button type="submit" size="sm">
                        {t('approve')}
                      </Button>
                    </form>
                  ) : null}
                  {run.status === 'APPROVED' && canPay ? (
                    <form action={createPayrollPaymentAction}>
                      <input type="hidden" name="id" value={run.id} />
                      <Button type="submit" variant="dark" size="sm">
                        {t('createPayment')}
                      </Button>
                    </form>
                  ) : null}
                  {run.status === 'PAID' && canPost ? (
                    <form action={markPostedAction}>
                      <input type="hidden" name="id" value={run.id} />
                      <Button type="submit" variant="outline" size="sm">
                        {t('markPosted')}
                      </Button>
                    </form>
                  ) : null}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
