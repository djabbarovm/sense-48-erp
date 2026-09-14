import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { NotFoundError, contractMachine, formatMoney, money } from '@finance-os/core';
import type { ContractStatus, ContractTrigger } from '@finance-os/core';
import { getContract360 } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Table, Td, Th } from '@/components/ui';
import { transitionContractAction } from '../actions';

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  const t = await getTranslations('contracts');

  let dto: Awaited<ReturnType<typeof getContract360>>;
  try {
    dto = await getContract360(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { contract, amendments, balance, vendor, customer } = dto;

  const triggers = contractMachine
    .availableTriggers(ctx, contract.status as ContractStatus, {
      registrationRequired: contract.registrationRequired,
      outstandingMinor: balance.outstandingMinor,
      openTasks: 0,
    })
    .filter((tr): tr is ContractTrigger => !['mark_expiring', 'expire', 'amendment_signed'].includes(tr));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{contract.number}</h1>
        <Badge tone={contract.status === 'ACTIVE' ? 'green' : 'gray'}>{t(`status.${contract.status}`)}</Badge>
        <span className="text-gray-500">{vendor?.displayName ?? customer?.legalName}</span>
      </div>

      <Card>
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div>
            <dt className="text-gray-500">{t('limit')}</dt>
            <dd className="font-medium">
              {contract.limitMinor != null ? formatMoney(money(contract.limitMinor, contract.currency)) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('committed')}</dt>
            <dd className="font-medium">{formatMoney(money(balance.committedMinor, contract.currency))}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('paid')}</dt>
            <dd className="font-medium">{formatMoney(money(balance.paidMinor, contract.currency))}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('outstanding')}</dt>
            <dd className="font-medium">{formatMoney(money(balance.outstandingMinor, contract.currency))}</dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {triggers.map((trigger) => (
            <form key={trigger} action={transitionContractAction}>
              <input type="hidden" name="id" value={contract.id} />
              <input type="hidden" name="trigger" value={trigger} />
              <Button type="submit" variant="outline">
                {t(`trigger.${trigger}`)}
              </Button>
            </form>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">{t('amendments')}</h2>
        <Table>
          <thead>
            <tr>
              <Th>{t('amendmentNumber')}</Th>
              <Th>{t('startDate')}</Th>
              <Th>{t('statusLabel')}</Th>
            </tr>
          </thead>
          <tbody>
            {amendments.map((a) => (
              <tr key={a.id}>
                <Td>{a.number}</Td>
                <Td>{a.date.toISOString().slice(0, 10)}</Td>
                <Td>
                  <Badge tone={a.status === 'SIGNED' ? 'green' : 'gray'}>{a.status}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
