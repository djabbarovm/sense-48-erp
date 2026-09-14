import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AlertTriangle, Users } from 'lucide-react';
import { NotFoundError, can, formatMoney, money } from '@finance-os/core';
import { getBatch, prisma, type BatchSummary } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, PageHeader, StatCard, Table, Td, Th } from '@/components/ui';
import {
  approveBatchAction,
  freezeBatchAction,
  markSentAction,
  removeFromBatchAction,
  reviewBatchAction,
  unfreezeBatchAction,
} from '../actions';

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

const ITEM_TONE: Record<string, 'green' | 'red' | 'blue' | 'yellow' | 'gray'> = {
  IN_BATCH: 'gray',
  APPROVED: 'green',
  REJECTED: 'red',
  SENT_TO_BANK: 'blue',
  PAID: 'green',
  RECONCILED: 'green',
  FAILED: 'red',
};

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  const t = await getTranslations('batches');

  let data: Awaited<ReturnType<typeof getBatch>>;
  try {
    data = await getBatch(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { batch, items, approvals } = data;
  const rawSummary = batch.summary as unknown as BatchSummary | null;
  const summary = rawSummary && typeof rawSummary.totalMinor === 'string' ? rawSummary : null;

  const vendorIds = [...new Set(items.map((i) => i.vendorId).filter((v): v is string => !!v))];
  const [vendors, users, account] = await Promise.all([
    prisma.vendor.findMany({ where: { tenantId: ctx.tenantId, id: { in: vendorIds } }, select: { id: true, displayName: true } }),
    prisma.user.findMany({
      where: { id: { in: [...new Set(approvals.map((a) => a.approverId))] } },
      select: { id: true, fullName: true },
    }),
    prisma.bankAccount.findUnique({ where: { id: batch.bankAccountId } }),
  ]);
  const vendorName = new Map(vendors.map((v) => [v.id, v.displayName]));
  const userName = new Map(users.map((u) => [u.id, u.fullName]));

  const canFreeze = can(ctx, 'batch.freeze');
  const canReview = can(ctx, 'batch.review') && batch.frozenBy !== ctx.userId;
  const canApprove = can(ctx, 'batch.approve');
  const canExport = can(ctx, 'batch.export');
  const canSend = can(ctx, 'batch.mark_sent');

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${batch.number}`}
        actions={<Badge tone={TONE[batch.status]}>{t(`status.${batch.status}`)}</Badge>}
      />
      <p className="-mt-3 text-sm text-gray-500">
        {batch.batchDate.toISOString().slice(0, 10)} · {account ? `${account.bankName} ${account.accountMasked}` : '—'} ·{' '}
        {batch.type === 'URGENT' ? t('typeUrgent') : t('typeStandard')}
      </p>

      {/* Summary (D-13 / BR-053) */}
      {summary ? (
        <>
          <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={t('total')} value={formatMoney(money(BigInt(summary.totalMinor), 'UZS'))} />
            <StatCard label={t('count')} value={summary.count} />
            <StatCard
              label={t('cashAfter')}
              value={formatMoney(money(BigInt(summary.cashAfterMinor), 'UZS'))}
              tone={summary.cashWarning ? 'danger' : 'success'}
              {...(summary.cashWarning ? { hint: t('cashWarning') } : {})}
            />
            <StatCard label={t('committed7d')} value={formatMoney(money(BigInt(summary.committedNext7dMinor), 'UZS'))} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title={t('byCategory')}>
              <ul className="space-y-1 text-sm">
                {Object.entries(summary.byCategory).map(([cat, sum]) => (
                  <li key={cat} className="flex items-center justify-between gap-2">
                    <span>{cat}</span>
                    <span className="money">{formatMoney(money(BigInt(sum), 'UZS'))}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-500">
                {t('urgentCount', { urgent: summary.byUrgency.urgent, standard: summary.byUrgency.standard })}
              </p>
            </Card>
            <Card title={t('exceptionsAndRisks')}>
              {summary.exceptions.length === 0 && summary.relatedParty.length === 0 ? (
                <p className="text-sm text-gray-500">{t('noExceptions')}</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {summary.exceptions.map((ex) => (
                    <li key={ex.number} className="flex items-start gap-1.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <span>
                        <span className="font-mono font-semibold">{ex.number}</span> · {ex.type}
                        {ex.reason ? ` — ${ex.reason}` : ''}
                      </span>
                    </li>
                  ))}
                  {summary.relatedParty.map((rp) => (
                    <li key={rp} className="flex items-start gap-1.5 text-red-700">
                      <Users className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        {t('relatedParty')}: {rp}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {Object.keys(summary.byControl).length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.entries(summary.byControl).map(([code, n]) => (
                    <Badge key={code} tone={code.endsWith(':FAIL') ? 'red' : 'yellow'}>
                      {code} × {n}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </Card>
          </div>
        </>
      ) : null}

      {/* Items: на REVIEWED — reject-чекбоксы внутри approve-формы */}
      <form action={approveBatchAction}>
        <input type="hidden" name="id" value={batch.id} />
        <Table>
          <thead>
            <tr>
              <Th>{t('itemNumber')}</Th>
              <Th>{t('vendor')}</Th>
              <Th>{t('purpose')}</Th>
              <Th className="text-right">{t('amount')}</Th>
              <Th>{t('statusLabel')}</Th>
              {batch.status === 'OPEN' ? <Th /> : null}
              {batch.status === 'REVIEWED' && canApprove ? <Th>{t('rejectCol')}</Th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <Td className="font-mono text-xs font-semibold">
                  {item.number}
                  {item.isUrgent ? (
                    <span className="ml-1.5">
                      <Badge tone="red">U</Badge>
                    </span>
                  ) : null}
                </Td>
                <Td>{item.vendorId ? (vendorName.get(item.vendorId) ?? '—') : '—'}</Td>
                <Td className="max-w-56 truncate">{item.purposeNote}</Td>
                <Td className="money text-right">{formatMoney(money(item.requestedMinor, item.currency))}</Td>
                <Td>
                  <Badge tone={ITEM_TONE[item.status] ?? 'gray'}>{item.status}</Badge>
                </Td>
                {batch.status === 'OPEN' ? (
                  <Td>
                    <Button type="submit" variant="ghost" size="sm" formAction={removeFromBatchAction} name="paymentId" value={item.id}>
                      {t('removeItem')}
                    </Button>
                  </Td>
                ) : null}
                {batch.status === 'REVIEWED' && canApprove ? (
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <input type="checkbox" name={`reject-${item.id}`} className="h-4 w-4 accent-red-600" aria-label={t('rejectCol')} />
                      <Input name={`comment-${item.id}`} placeholder={t('rejectComment')} className="w-36 text-xs" />
                    </div>
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
        {batch.status === 'OPEN' ? <input type="hidden" name="batchId" value={batch.id} /> : null}

        {/* Кнопки по роли и статусу */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {batch.status === 'OPEN' && canFreeze ? (
            <Button type="submit" formAction={freezeBatchAction} name="id" value={batch.id}>
              {t('freeze')}
            </Button>
          ) : null}
          {batch.status === 'FROZEN' && can(ctx, 'batch.unfreeze') ? (
            <Button type="submit" variant="outline" formAction={unfreezeBatchAction} name="id" value={batch.id}>
              {t('unfreeze')}
            </Button>
          ) : null}
          {batch.status === 'FROZEN' && canReview ? (
            <Button type="submit" formAction={reviewBatchAction} name="id" value={batch.id}>
              {t('review')}
            </Button>
          ) : null}
          {batch.status === 'REVIEWED' && canApprove ? <Button type="submit">{t('approve')}</Button> : null}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {['APPROVED', 'PARTIALLY_APPROVED'].includes(batch.status) && canExport ? (
          <form method="post" action={`/batches/${batch.id}/export`}>
            <Button type="submit" variant="dark">
              {t('exportCsv')}
            </Button>
          </form>
        ) : null}
        {['APPROVED', 'PARTIALLY_APPROVED', 'EXPORTED', 'SENT'].includes(batch.status) && canExport ? (
          <form method="post" action={`/batches/${batch.id}/export-1c`}>
            <Button type="submit" variant="outline">
              {t('export1c')}
            </Button>
          </form>
        ) : null}
        {batch.status === 'EXPORTED' && canSend ? (
          <form action={markSentAction}>
            <input type="hidden" name="id" value={batch.id} />
            <Button type="submit">{t('markSent')}</Button>
          </form>
        ) : null}
      </div>

      {/* История approvals */}
      {approvals.length > 0 ? (
        <Card title={t('approvalsHistory')}>
          <ul className="space-y-1.5 text-sm">
            {approvals.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={a.decision === 'APPROVED' ? 'green' : 'red'}>{a.decision}</Badge>
                <span className="font-medium">{userName.get(a.approverId) ?? a.approverId}</span>
                <span className="text-gray-500">
                  {a.scope}
                  {a.comment ? ` · ${a.comment}` : ''} · {a.decidedAt.toISOString().slice(0, 16).replace('T', ' ')}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
