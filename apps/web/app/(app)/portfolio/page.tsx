import { getTranslations } from 'next-intl/server';
import { getPortfolio } from '@finance-os/db';
import { requireSessionUser } from '@/lib/session';
import { Badge, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';

export default async function PortfolioPage() {
  const user = await requireSessionUser();
  const t = await getTranslations('portfolio');
  const rows = await getPortfolio(user.id);

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} />
      <p className="-mt-2 text-sm text-gray-500">{t('intro')}</p>
      <Table>
        <thead>
          <tr>
            <Th>{t('company')}</Th>
            <Th>{t('roles')}</Th>
            <Th className="text-right">{t('batchesToday')}</Th>
            <Th className="text-right">{t('ready')}</Th>
            <Th className="text-right">{t('blocked')}</Th>
            <Th className="text-right">{t('overdueTasks')}</Th>
            <Th className="text-right">{t('unmatched')}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.tenantId}>
              <Td className="font-medium">{row.legalName}</Td>
              <Td className="text-xs text-gray-500">{row.roles.join(', ')}</Td>
              <Td className="tnum text-right">{row.batchesToday}</Td>
              <Td className="tnum text-right">{row.readyPayments}</Td>
              <Td className="text-right">
                <Badge tone={row.blockedPayments > 0 ? 'red' : 'green'}>{row.blockedPayments}</Badge>
              </Td>
              <Td className="text-right">
                <Badge tone={row.overdueTasks > 0 ? 'red' : 'green'}>{row.overdueTasks}</Badge>
              </Td>
              <Td className="text-right">
                <Badge tone={row.unmatchedTx > 0 ? 'yellow' : 'green'}>{row.unmatchedTx}</Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {rows.length === 0 ? <EmptyState text={t('empty')} /> : null}
      <p className="text-xs text-gray-400">{t('switchHint')}</p>
    </div>
  );
}
