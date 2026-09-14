import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowRight, Banknote, FileClock, ShieldCheck, Zap } from 'lucide-react';
import { can, formatMoney, money } from '@finance-os/core';
import { listPayments, prisma } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from '@/components/ui';
import {
  approveExceptionAction,
  cancelPaymentAction,
  collectBatchAction,
  resolveHoldAction,
  submitDraftAction,
} from './actions';

const EXCEPTION_TYPES = ['OVER_OUTSTANDING', 'NO_CONTRACT', 'NO_RECEIPT', 'UNVERIFIED_BANK', 'UNBUDGETED'] as const;

interface ControlSnap {
  code: string;
  result: 'PASS' | 'WARN' | 'FAIL';
  detail?: string;
}

export default async function PaymentsPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'payment.view')) notFound();
  const t = await getTranslations('payments');

  const [payments, bankAccounts] = await Promise.all([
    listPayments(ctx, {
      status: ['DRAFT', 'SUBMITTED', 'DOCS_CHECK', 'ON_HOLD', 'READY_FOR_BATCH', 'IN_BATCH', 'APPROVED', 'SENT_TO_BANK', 'FAILED'],
    }),
    prisma.bankAccount.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { bankName: 'asc' } }),
  ]);
  const vendors = new Map(
    (
      await prisma.vendor.findMany({
        where: { tenantId: ctx.tenantId, id: { in: [...new Set(payments.map((p) => p.vendorId).filter((v): v is string => !!v))] } },
        select: { id: true, displayName: true },
      })
    ).map((v) => [v.id, v.displayName]),
  );

  const ready = payments.filter((p) => p.status === 'READY_FOR_BATCH');
  const blocked = payments.filter((p) => p.status === 'ON_HOLD');
  const pending = payments.filter((p) => ['DRAFT', 'SUBMITTED', 'DOCS_CHECK'].includes(p.status));
  const inFlight = payments.filter((p) => ['IN_BATCH', 'APPROVED', 'SENT_TO_BANK', 'FAILED'].includes(p.status));

  const canCreate = can(ctx, 'payment.create');
  const canException = can(ctx, 'payment.exception.approve');
  const canBatch = can(ctx, 'batch.create');
  const readyTotal = ready.reduce((sum, p) => sum + p.requestedMinor, 0n);

  const vendorOf = (id: string | null) => (id ? (vendors.get(id) ?? '—') : '—');

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        actions={
          canCreate ? (
            <Link href="/payments/new">
              <Button>{t('newPayment')}</Button>
            </Link>
          ) : undefined
        }
      />

      <div className="stagger grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {/* Ready */}
        <Card className="card-lift border-t-2 border-t-volt-500">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <ShieldCheck className="h-4 w-4 text-volt-600" /> {t('ready')}
            </h2>
            <Badge tone="green">{ready.length}</Badge>
          </div>
          <p className="mb-3 text-xs text-gray-500">
            {t('readyTotal')}: <span className="money">{formatMoney(money(readyTotal, 'UZS'))}</span>
          </p>
          {canBatch && ready.length > 0 && bankAccounts.length > 0 ? (
            <form action={collectBatchAction} className="mb-3 flex items-center gap-2">
              <Select name="bankAccountId" required className="flex-1">
                {bankAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.bankName} {acc.accountMasked}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm">
                <Banknote className="h-4 w-4" /> {t('collectBatch')}
              </Button>
            </form>
          ) : null}
          <ul className="space-y-2">
            {ready.map((p) => (
              <li key={p.id} className="rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold">{p.number}</span>
                  <span className="money text-sm">{formatMoney(money(p.requestedMinor, p.currency))}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-gray-500">
                  <span className="truncate">{vendorOf(p.vendorId)}</span>
                  {p.isUrgent ? (
                    <Badge tone="red">
                      <Zap className="h-3 w-3" /> {t('urgent')}
                    </Badge>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {ready.length === 0 ? <EmptyState text={t('emptyReady')} /> : null}
        </Card>

        {/* Blocked */}
        <Card className="card-lift border-t-2 border-t-red-400">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <AlertTriangle className="h-4 w-4 text-red-500" /> {t('blocked')}
            </h2>
            <Badge tone={blocked.length > 0 ? 'red' : 'gray'}>{blocked.length}</Badge>
          </div>
          <ul className="space-y-2">
            {blocked.map((p) => {
              const fails = ((p.controlsResult as unknown as ControlSnap[]) ?? []).filter((c) => c.result === 'FAIL');
              const matched = EXCEPTION_TYPES.filter((type) => fails.some((c) => c.code === type));
              const exceptionOptions = matched.length > 0 ? matched : EXCEPTION_TYPES;
              return (
                <li key={p.id} className="rounded-md border border-red-100 bg-red-50/50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{p.number}</span>
                    <span className="money text-sm">{formatMoney(money(p.requestedMinor, p.currency))}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500">{vendorOf(p.vendorId)}</p>
                  <ul className="mt-1.5 space-y-1">
                    {fails.map((c) => (
                      <li key={c.code} className="text-xs text-red-700">
                        <span className="font-mono font-semibold">{c.code}</span>
                        {c.detail ? ` — ${c.detail}` : null}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-gray-400">{t('escalateTo')}</p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    <form action={resolveHoldAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <Button type="submit" variant="outline" size="sm">
                        {t('recheck')}
                      </Button>
                    </form>
                    {canException ? (
                      <form action={approveExceptionAction} className="flex flex-wrap items-center gap-1.5">
                        <input type="hidden" name="id" value={p.id} />
                        <Select name="exceptionType" className="w-auto flex-1 text-xs">
                          {exceptionOptions.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </Select>
                        <Input name="reason" placeholder={t('exceptionReason')} required className="w-32 flex-1 text-xs" />
                        <Button type="submit" variant="dark" size="sm">
                          {t('approveException')}
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {blocked.length === 0 ? <EmptyState text={t('emptyBlocked')} /> : null}
        </Card>

        {/* Pending docs / draft */}
        <Card className="card-lift border-t-2 border-t-amber-400">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <FileClock className="h-4 w-4 text-amber-500" /> {t('pendingDocs')}
            </h2>
            <Badge tone={pending.length > 0 ? 'yellow' : 'gray'}>{pending.length}</Badge>
          </div>
          <ul className="space-y-2">
            {pending.map((p) => (
              <li key={p.id} className="rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold">{p.number}</span>
                  <span className="money text-sm">{formatMoney(money(p.requestedMinor, p.currency))}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-gray-500">{vendorOf(p.vendorId)}</span>
                  <Badge tone="gray">{t(`status.${p.status}`)}</Badge>
                </div>
                {p.status === 'DRAFT' && canCreate ? (
                  <div className="mt-2 flex items-center gap-1.5">
                    <form action={submitDraftAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <Button type="submit" variant="outline" size="sm">
                        {t('submit')} <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </form>
                    <form action={cancelPaymentAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <Button type="submit" variant="ghost" size="sm">
                        {t('cancel')}
                      </Button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {pending.length === 0 ? <EmptyState text={t('emptyPending')} /> : null}
        </Card>
      </div>

      {/* В работе: в batch / отправлено в банк */}
      {inFlight.length > 0 ? (
        <Card title={t('inFlight')} className="card-lift">
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {inFlight.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-semibold">{p.number}</span>
                  <p className="truncate text-xs text-gray-500">{vendorOf(p.vendorId)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="money text-sm">{formatMoney(money(p.requestedMinor, p.currency))}</span>
                  <Badge tone={p.status === 'FAILED' ? 'red' : p.status === 'SENT_TO_BANK' ? 'blue' : 'gray'}>
                    {t(`status.${p.status}`)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
