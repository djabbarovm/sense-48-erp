import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, formatMoney, money } from '@finance-os/core';
import { listBatches, prisma } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { createBatchAction } from './actions';

const TONE = {
  OPEN: 'blue',
  FROZEN: 'yellow',
  REVIEWED: 'yellow',
  APPROVED: 'green',
  PARTIALLY_APPROVED: 'green',
  EXPORTED: 'blue',
  SENT: 'blue',
  SETTLED: 'green',
  CANCELLED: 'gray',
} as const;

export default async function BatchesPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'payment.view')) notFound();
  const t = await getTranslations('batches');

  const [batches, bankAccounts] = await Promise.all([
    listBatches(ctx),
    prisma.bankAccount.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { bankName: 'asc' } }),
  ]);
  const accounts = new Map(bankAccounts.map((a) => [a.id, `${a.bankName} ${a.accountMasked}`]));
  const canCreate = can(ctx, 'batch.create');

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} />

      {canCreate && bankAccounts.length > 0 ? (
        <Card title={t('newBatch')}>
          <form action={createBatchAction} className="flex flex-wrap items-center gap-2">
            <Select name="bankAccountId" required className="w-auto flex-1">
              {bankAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.bankName} {acc.accountMasked}
                </option>
              ))}
            </Select>
            <Select name="type" className="w-auto">
              <option value="STANDARD">{t('typeStandard')}</option>
              <option value="URGENT">{t('typeUrgent')}</option>
            </Select>
            <Button type="submit">{t('create')}</Button>
          </form>
        </Card>
      ) : null}

      <Table>
        <thead>
          <tr>
            <Th>{t('numberCol')}</Th>
            <Th>{t('date')}</Th>
            <Th>{t('account')}</Th>
            <Th>{t('typeCol')}</Th>
            <Th className="text-right">{t('count')}</Th>
            <Th className="text-right">{t('total')}</Th>
            <Th>{t('statusLabel')}</Th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id}>
              <Td className="font-medium">
                <Link href={`/batches/${batch.id}`} className="text-brand-700 hover:underline">
                  {batch.number}
                </Link>
              </Td>
              <Td>{batch.batchDate.toISOString().slice(0, 10)}</Td>
              <Td>{accounts.get(batch.bankAccountId) ?? '—'}</Td>
              <Td>{batch.type === 'URGENT' ? <Badge tone="red">{t('typeUrgent')}</Badge> : t('typeStandard')}</Td>
              <Td className="tnum text-right">{batch.count}</Td>
              <Td className="money text-right">{formatMoney(money(batch.totalMinor, 'UZS'))}</Td>
              <Td>
                <Badge tone={TONE[batch.status]}>{t(`status.${batch.status}`)}</Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {batches.length === 0 ? <EmptyState text={t('empty')} /> : null}
    </div>
  );
}
