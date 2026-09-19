import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, formatMoney, money } from '@finance-os/core';
import { listPrs } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, PageHeader, Table, Td, Th } from '@/components/ui';

const TONE = {
  DRAFT: 'gray', SUBMITTED: 'blue', APPROVED: 'green', REJECTED: 'red', ORDERED: 'blue',
  RECEIVED: 'blue', INVOICED: 'blue', PAID: 'green', CLOSED: 'gray', CANCELLED: 'gray',
} as const;

export default async function PrListPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'pr.view')) notFound(); // защита в глубину: экран закрыт и по прямой ссылке, не только фильтром меню
  const t = await getTranslations('pr');
  const prs = await listPrs(ctx);
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('title')}
        actions={
          <Link href="/pr/new">
            <Button>{t('new')}</Button>
          </Link>
        }
      />
      <Table>
        <thead>
          <tr>
            <Th>{t('numberCol')}</Th>
            <Th>{t('what')}</Th>
            <Th className="text-right">{t('amount')}</Th>
            <Th>{t('statusLabel')}</Th>
            <Th>{t('budget')}</Th>
          </tr>
        </thead>
        <tbody>
          {prs.map((pr) => (
            <tr key={pr.id}>
              <Td>
                <Link href={`/pr/${pr.id}`} className="text-brand hover:underline">
                  {pr.number}
                </Link>
              </Td>
              <Td>{pr.what}</Td>
              <Td className="money text-right">{formatMoney(money(pr.totalMinor, pr.currency))}</Td>
              <Td>
                <Badge tone={TONE[pr.status]}>{t(`status.${pr.status}`)}</Badge>
                {pr.isFastLane ? <Badge tone="blue">{t('fastLane')}</Badge> : null}
              </Td>
              <Td>{pr.budgetStatus ? <Badge tone={pr.budgetStatus === 'WITHIN' ? 'green' : 'yellow'}>{t(`budgetBadge.${pr.budgetStatus}`)}</Badge> : '—'}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
