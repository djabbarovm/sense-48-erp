import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Banknote } from 'lucide-react';
import { can, formatMoney, money } from '@finance-os/core';
import { listBatches, listMyPendingApprovals, prisma, type BatchSummary } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input } from '@/components/ui';
import { decideApprovalAction } from '../pr/actions';
import { approveBatchAction } from '../batches/actions';

interface ControlSnap {
  code: string;
  result: 'PASS' | 'WARN' | 'FAIL';
  detail?: string;
}

export default async function ApprovalsPage() {
  const ctx = await requireTenantContext();
  const t = await getTranslations('approvals');
  const tPr = await getTranslations('pr');
  const tB = await getTranslations('batches');
  const pending = await listMyPendingApprovals(ctx);

  // Batch-режим (C-05): REVIEWED реестры ждут Owner
  const canApproveBatch = can(ctx, 'batch.approve');
  const reviewedBatches = canApproveBatch ? (await listBatches(ctx)).filter((b) => b.status === 'REVIEWED') : [];
  const batchItems = new Map<string, Awaited<ReturnType<typeof prisma.paymentRequest.findMany>>>();
  const vendorName = new Map<string, string>();
  for (const batch of reviewedBatches) {
    const items = await prisma.paymentRequest.findMany({ where: { batchId: batch.id, status: 'IN_BATCH' }, orderBy: { number: 'asc' } });
    batchItems.set(batch.id, items);
    const vendors = await prisma.vendor.findMany({
      where: { tenantId: ctx.tenantId, id: { in: items.map((i) => i.vendorId).filter((v): v is string => !!v) } },
      select: { id: true, displayName: true },
    });
    for (const v of vendors) vendorName.set(v.id, v.displayName);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="font-display text-xl font-bold tracking-tight">{t('title')}</h1>
      {pending.length === 0 && reviewedBatches.length === 0 ? <p className="text-gray-500">{t('empty')}</p> : null}

      {/* Batch-режим: summary-шапка, «Approve all green», toggle на красных */}
      {reviewedBatches.map((batch) => {
        const rawSummary = batch.summary as unknown as BatchSummary | null;
        const summary = rawSummary && typeof rawSummary.totalMinor === 'string' ? rawSummary : null;
        const items = batchItems.get(batch.id) ?? [];
        const isRed = (item: (typeof items)[number]) => {
          const controls = (item.controlsResult as unknown as ControlSnap[]) ?? [];
          return Boolean(item.exceptionType) || controls.some((c) => c.result !== 'PASS');
        };
        const red = items.filter(isRed);
        const green = items.filter((i) => !isRed(i));
        return (
          <Card key={batch.id} className="card-lift animate-rise border-t-2 border-t-volt-500">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/batches/${batch.id}`} className="flex items-center gap-2 font-semibold text-brand-700 hover:underline">
                <Banknote className="h-4 w-4" /> {batch.number}
              </Link>
              <Badge tone="yellow">{tB('status.REVIEWED')}</Badge>
            </div>
            {summary ? (
              <p className="mt-1.5 text-sm text-gray-600">
                {t('batchSummary', { count: summary.count })}{' '}
                <b className="money">{formatMoney(money(BigInt(summary.totalMinor), 'UZS'))}</b>
                {summary.exceptions.length > 0 ? ` · exceptions: ${summary.exceptions.length}` : ''}
                {summary.relatedParty.length > 0 ? ` · related party: ${summary.relatedParty.length}` : ''}
              </p>
            ) : null}
            <form action={approveBatchAction} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={batch.id} />
              {green.length > 0 ? (
                <div className="rounded-md border border-volt-500/30 bg-volt-500/5 px-3 py-2">
                  <p className="text-xs font-semibold tracking-wide text-volt-700 uppercase">{t('greenItems', { count: green.length })}</p>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {green.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          <span className="font-mono text-xs font-semibold">{item.number}</span>{' '}
                          <span className="text-gray-500">{item.vendorId ? vendorName.get(item.vendorId) : '—'}</span>
                        </span>
                        <span className="money shrink-0">{formatMoney(money(item.requestedMinor, item.currency))}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {red.map((item) => {
                const fails = ((item.controlsResult as unknown as ControlSnap[]) ?? []).filter((c) => c.result !== 'PASS');
                return (
                  <div key={item.id} className="rounded-md border border-red-200 bg-red-50/50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                        <span className="font-mono text-xs font-semibold">{item.number}</span>
                        <span className="text-gray-500">{item.vendorId ? vendorName.get(item.vendorId) : '—'}</span>
                      </span>
                      <span className="money shrink-0">{formatMoney(money(item.requestedMinor, item.currency))}</span>
                    </div>
                    {item.exceptionType ? (
                      <p className="mt-0.5 text-xs text-amber-700">
                        exception {item.exceptionType}: {item.exceptionReason}
                      </p>
                    ) : null}
                    {fails.map((c) => (
                      <p key={c.code} className="mt-0.5 text-xs text-red-700">
                        <span className="font-mono font-semibold">{c.code}</span>
                        {c.detail ? ` — ${c.detail}` : ''}
                      </p>
                    ))}
                    <label className="mt-1.5 flex items-center gap-2 text-xs text-gray-700">
                      <input type="checkbox" name={`reject-${item.id}`} className="h-4 w-4 accent-red-600" />
                      {t('rejectToggle')}
                      <Input name={`comment-${item.id}`} placeholder={tB('rejectComment')} className="w-44 text-xs" />
                    </label>
                  </div>
                );
              })}
              <Button type="submit" className="w-full sm:w-auto">
                {t('approveAllGreen')}
              </Button>
            </form>
          </Card>
        );
      })}

      {/* Item-режим: PR approvals */}
      {pending.map(({ pr, slot }) => (
        <Card key={slot.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/pr/${pr.id}`} className="font-medium text-brand hover:underline">
              {pr.number}
            </Link>
            <Badge tone="blue">{slot.role}</Badge>
            {pr.budgetStatus ? (
              <Badge tone={pr.budgetStatus === 'WITHIN' ? 'green' : 'yellow'}>
                {tPr(`budgetBadge.${pr.budgetStatus}`)}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm">
            {pr.what} — <b>{formatMoney(money(pr.totalMinor, pr.currency))}</b>
          </p>
          <p className="text-sm text-gray-500">{pr.purpose}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <form action={decideApprovalAction}>
              <input type="hidden" name="id" value={pr.id} />
              <input type="hidden" name="role" value={slot.role} />
              <input type="hidden" name="decision" value="APPROVED" />
              <Button type="submit">{t('approve')}</Button>
            </form>
            <form action={decideApprovalAction} className="flex items-center gap-1">
              <input type="hidden" name="id" value={pr.id} />
              <input type="hidden" name="role" value={slot.role} />
              <input type="hidden" name="decision" value="REJECTED" />
              <Input name="comment" placeholder={tPr('rejectComment')} className="w-56" />
              <Button type="submit" variant="danger">
                {t('reject')}
              </Button>
            </form>
          </div>
        </Card>
      ))}
    </div>
  );
}
