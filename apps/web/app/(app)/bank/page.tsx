import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Landmark } from 'lucide-react';
import { can, formatMoney, money } from '@finance-os/core';
import { getCashPosition, listBankTransactions, listPayments, prisma } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Select, StatCard, Table, Td, Th } from '@/components/ui';
import { BankImportForm } from './import-form';
import { ignoreTxAction, manualMatchAction, markFailedAction } from './actions';

const TONE = {
  UNMATCHED: 'red',
  SUGGESTED: 'yellow',
  AUTO_MATCHED: 'green',
  MANUAL_MATCHED: 'green',
  IGNORED: 'gray',
} as const;

export default async function BankPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'bank.import')) notFound();
  const t = await getTranslations('bank');

  const [cash, transactions, sentPayments, accounts] = await Promise.all([
    getCashPosition(ctx),
    listBankTransactions(ctx),
    listPayments(ctx, { status: ['SENT_TO_BANK'] }),
    prisma.bankAccount.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { bankName: 'asc' } }),
  ]);
  const canManual = can(ctx, 'bank.reconcile.manual');
  // кандидаты на ручной матч: только дебеты с подходящей суммой, иначе весь SENT-список
  const candidatesFor = (amountMinor: bigint) => {
    const abs = amountMinor < 0n ? -amountMinor : amountMinor;
    const exact = sentPayments.filter((p) => p.requestedMinor === abs);
    return exact.length > 0 ? exact : sentPayments;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Landmark className="h-5 w-5 text-volt-600" />
        <h1 className="font-display text-xl font-bold tracking-tight">{t('title')}</h1>
      </div>

      {/* Cash position */}
      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cash.map(({ account, balanceMinor }) => (
          <StatCard
            key={account.id}
            label={`${account.bankName} ${account.accountMasked}`}
            value={formatMoney(money(balanceMinor, account.currency))}
            tone={balanceMinor < 0n ? 'danger' : 'default'}
          />
        ))}
      </div>

      <BankImportForm accounts={accounts.map((a) => ({ id: a.id, label: `${a.bankName} ${a.accountMasked} (${a.currency})` }))} />

      {/* Транзакции */}
      <Table>
        <thead>
          <tr>
            <Th>{t('date')}</Th>
            <Th>{t('counterparty')}</Th>
            <Th>{t('purpose')}</Th>
            <Th className="text-right">{t('amount')}</Th>
            <Th>{t('statusLabel')}</Th>
            {canManual ? <Th>{t('actions')}</Th> : null}
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.id}>
              <Td>{tx.bookingDate.toISOString().slice(0, 10)}</Td>
              <Td className="max-w-48 truncate">{tx.counterpartyName}</Td>
              <Td className="max-w-64 truncate text-gray-500">{tx.purposeText}</Td>
              <Td className={`money text-right ${tx.amountMinor < 0n ? '' : 'text-volt-700'}`}>
                {formatMoney(money(tx.amountMinor, tx.currency))}
              </Td>
              <Td>
                <Badge tone={TONE[tx.matchStatus]}>{t(`status.${tx.matchStatus}`)}</Badge>
              </Td>
              {canManual ? (
                <Td>
                  {['UNMATCHED', 'SUGGESTED'].includes(tx.matchStatus) && tx.amountMinor < 0n ? (
                    <div className="flex flex-col gap-1.5">
                      {candidatesFor(tx.amountMinor).length > 0 ? (
                        <form action={manualMatchAction} className="flex items-center gap-1.5">
                          <input type="hidden" name="transactionId" value={tx.id} />
                          <Select name="paymentId" className="w-auto text-xs">
                            {candidatesFor(tx.amountMinor).map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.number} · {formatMoney(money(p.requestedMinor, p.currency))}
                              </option>
                            ))}
                          </Select>
                          <Button type="submit" variant="outline" size="sm">
                            {t('match')}
                          </Button>
                        </form>
                      ) : null}
                      <form action={ignoreTxAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="transactionId" value={tx.id} />
                        <Input name="reason" placeholder={t('ignoreReason')} required className="w-36 text-xs" />
                        <Button type="submit" variant="ghost" size="sm">
                          {t('ignore')}
                        </Button>
                      </form>
                    </div>
                  ) : (
                    '—'
                  )}
                </Td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </Table>
      {transactions.length === 0 ? <EmptyState text={t('emptyTx')} /> : null}

      {/* FAILED path: платежи в банке */}
      {canManual && sentPayments.length > 0 ? (
        <Card title={t('sentTitle')}>
          <ul className="space-y-2">
            {sentPayments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2">
                <div>
                  <span className="font-mono text-xs font-semibold">{p.number}</span>
                  <span className="money ml-3 text-sm">{formatMoney(money(p.requestedMinor, p.currency))}</span>
                  <p className="text-xs text-gray-500">{p.purposeNote}</p>
                </div>
                <form action={markFailedAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="paymentId" value={p.id} />
                  <Input name="reason" placeholder={t('failReason')} required className="w-44 text-xs" />
                  <Button type="submit" variant="danger" size="sm">
                    {t('markFailed')}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
