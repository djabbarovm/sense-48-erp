import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, ArrowLeft, CheckCheck, FileCheck, Play, RotateCcw, Star, UserCheck, XCircle } from 'lucide-react';
import { NotFoundError, can } from '@finance-os/core';
import { createStorageFromEnv } from '@finance-os/adapters';
import { getServiceOrder, listAssignees } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, PageHeader, Select, cn } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';
import { PROVIDER_TONE, STATUS_TONE } from '../tones';
import { rateServiceOrderAction, transitionServiceOrderAction, uploadServiceProofAction } from '../actions';

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3 text-[13px]"><dt className="text-gray-500">{k}</dt><dd className="text-right font-medium text-gray-900">{v}</dd></div>;
}

export default async function ServiceOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'service.view')) notFound();
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getTranslations('services');
  let data: Awaited<ReturnType<typeof getServiceOrder>>;
  try {
    data = await getServiceOrder(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { order: o, proofs, audit, triggers, canUpload, canRate } = data;
  const assignees = triggers.includes('accept') || triggers.includes('start') ? await listAssignees(ctx) : [];
  const storage = createStorageFromEnv();
  const proofUrls = await Promise.all(proofs.map(async (p) => ({ ...p, url: await storage.getSignedUrl(p.fileKey).catch(() => null) })));
  const dt = (d: Date | string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-5">
      <PageHeader
        title={<span className="font-mono">{o.number}</span>}
        meta={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[o.status]} dot>{t(`status.${o.status}`)}</Badge><Badge tone={PROVIDER_TONE[o.providerKind]}>{o.partnerName ?? t(`providerKind.${o.providerKind}`)}</Badge>{o.overdue ? <Badge tone="red">{t('overdue')}</Badge> : null}</span>}
        actions={<Link href="/services" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"><ArrowLeft className="h-4 w-4" />{t('toList')}</Link>}
      />
      {error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${error}`) ? t(`error.${error}`) : t('error.GENERIC')}</div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="text-[15px] font-semibold text-gray-900">{o.serviceName}{o.quantity > 1 ? <span className="ml-1 text-sm text-gray-500">× {o.quantity}</span> : null}</h3>
          <p className="text-xs text-gray-500">{t(`category.${o.category}`)} · <span className="font-mono">{o.serviceCode}</span></p>
          {o.notes ? <p className="mt-1 text-sm text-gray-700">{o.notes}</p> : null}
          <dl className="mt-3 space-y-1.5">
            <Row k={t('fields.unit')} v={o.unitId ? <Link href={`/property/units/${o.unitId}`} className="font-mono text-brand-600 hover:underline">{o.unitNo}</Link> : (o.buildingName ?? '—')} />
            {o.customerName ? <Row k={t('fields.customer')} v={o.customerName} /> : null}
            <Row k={t('fields.price')} v={<span className="font-mono">{fmtRate(o.priceMinor, o.currency)}</span>} />
            {o.providerKind === 'PARTNER' ? <><Row k={t('fields.commission')} v={`${o.commissionBp / 100}%`} /><Row k={t('fields.platformRevenue')} v={<span className="font-mono text-emerald-600">{fmtRate(o.platformRevenueMinor, o.currency)}</span>} /><Row k={t('fields.partnerPayout')} v={<span className="font-mono">{fmtRate(o.partnerPayoutMinor, o.currency)}</span>} /></> : null}
            <Row k={t('fields.orderer')} v={o.ordererName} />
            <Row k={t('fields.assignee')} v={o.assigneeName ?? <span className="text-gray-400">{t('fields.unassigned')}</span>} />
            <Row k={t('fields.scheduledAt')} v={<span className="font-mono">{dt(o.scheduledAt)}</span>} />
            <Row k={t('fields.due')} v={<span className={cn('font-mono', o.overdue ? 'text-red-600' : '')}>{dt(o.dueAt)}{o.hoursLeft != null ? ` · ${o.overdue ? t('overdueBy', { h: Math.abs(o.hoursLeft) }) : t('hoursLeft', { h: o.hoursLeft })}` : ''}</span>} />
            <Row k={t('fields.created')} v={fmtDate(o.createdAt)} />
            {o.acceptedAt ? <Row k={t('fields.accepted')} v={fmtDate(o.acceptedAt)} /> : null}
            {o.startedAt ? <Row k={t('fields.started')} v={fmtDate(o.startedAt)} /> : null}
            {o.doneAt ? <Row k={t('fields.done')} v={fmtDate(o.doneAt)} /> : null}
            {o.verifiedAt ? <Row k={t('fields.verified')} v={fmtDate(o.verifiedAt)} /> : null}
            {o.cancelReason ? <Row k={t('fields.cancelReason')} v={o.cancelReason} /> : null}
            {o.rating != null ? <Row k={t('fields.rating')} v={<span className="inline-flex items-center gap-1 text-amber-600"><Star className="h-3.5 w-3.5" />{t('rated', { r: o.rating })}</span>} /> : null}
            {o.ratingComment ? <Row k={t('fields.ratingComment')} v={o.ratingComment} /> : null}
          </dl>
        </Card>

        <Card>
          <h3 className="font-display text-sm font-semibold">{t('actions')}</h3>
          <div className="mt-3 space-y-3">
            {triggers.includes('accept') ? (
              <form action={transitionServiceOrderAction} className="space-y-2 rounded-md bg-gray-50 p-3">
                <input type="hidden" name="id" value={o.id} /><input type="hidden" name="trigger" value="accept" />
                <div><Label htmlFor="a-assignee">{t('fields.assignee')}</Label><Select id="a-assignee" name="assigneeId" defaultValue={o.assigneeId ?? ''}><option value="">{t('fields.unassigned')}</option>{assignees.map((a) => (<option key={a.id} value={a.id}>{a.fullName}</option>))}</Select></div>
                <Button type="submit" size="sm" variant="outline"><UserCheck className="h-3.5 w-3.5" />{t('trigger.accept')}</Button>
              </form>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {triggers.includes('start') ? <form action={transitionServiceOrderAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="trigger" value="start" /><Button type="submit" size="sm"><Play className="h-3.5 w-3.5" />{t('trigger.start')}</Button></form> : null}
              {triggers.includes('done') ? <form action={transitionServiceOrderAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="trigger" value="done" /><Button type="submit" size="sm"><CheckCheck className="h-3.5 w-3.5" />{t('trigger.done')}</Button></form> : null}
              {triggers.includes('verify') ? <form action={transitionServiceOrderAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="trigger" value="verify" /><Button type="submit" size="sm" disabled={proofs.length === 0} title={proofs.length === 0 ? t('error.PROOF_REQUIRED') : undefined}><CheckCheck className="h-3.5 w-3.5" />{t('trigger.verify')}</Button></form> : null}
            </div>
            {o.status === 'DONE' && !triggers.includes('verify') && can(ctx, 'service.verify') ? <p className="text-xs text-gray-500">{t('selfVerifyHint')}</p> : null}
            {triggers.includes('reopen') ? (
              <form action={transitionServiceOrderAction} className="flex items-end gap-2"><input type="hidden" name="id" value={o.id} /><input type="hidden" name="trigger" value="reopen" /><div className="flex-1"><Label htmlFor="r-reason">{t('fields.reason')}</Label><Input id="r-reason" name="reason" required /></div><Button type="submit" size="sm" variant="outline"><RotateCcw className="h-3.5 w-3.5" />{t('trigger.reopen')}</Button></form>
            ) : null}
            {triggers.includes('cancel') ? (
              <form action={transitionServiceOrderAction} className="flex items-end gap-2"><input type="hidden" name="id" value={o.id} /><input type="hidden" name="trigger" value="cancel" /><div className="flex-1"><Label htmlFor="c-reason">{t('fields.reason')}</Label><Input id="c-reason" name="reason" required /></div><Button type="submit" size="sm" variant="danger"><XCircle className="h-3.5 w-3.5" />{t('trigger.cancel')}</Button></form>
            ) : null}
            {canRate && o.rating == null ? (
              <form action={rateServiceOrderAction} className="flex items-end gap-2 border-t border-gray-100 pt-3"><input type="hidden" name="id" value={o.id} /><div><Label htmlFor="rt">{t('fields.rating')}</Label><Select id="rt" name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((n) => (<option key={n} value={n}>{'★'.repeat(n)}</option>))}</Select></div><div className="flex-1"><Label htmlFor="rc">{t('fields.ratingComment')}</Label><Input id="rc" name="comment" /></div><Button type="submit" size="sm" variant="outline"><Star className="h-3.5 w-3.5" />{t('rate')}</Button></form>
            ) : null}
            {triggers.length === 0 && !(canRate && o.rating == null) ? <p className="text-sm text-gray-400">{t('noActions')}</p> : null}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2"><FileCheck className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('proofs')}</h3></div>
          <p className="mt-1 text-xs text-gray-500">{t('proofsHint')}</p>
          {canUpload ? (
            <form action={uploadServiceProofAction} className="mt-3 flex items-center gap-2">
              <input type="hidden" name="id" value={o.id} />
              <Input type="file" name="file" accept="image/*,application/pdf" required className="flex-1" aria-label={t('proofFile')} />
              <Button type="submit" size="sm" variant="outline">{t('upload')}</Button>
            </form>
          ) : null}
          <ul className="mt-3 grid grid-cols-2 gap-2">
            {proofUrls.length === 0 ? <li className="col-span-2 text-sm text-gray-400">{t('noProofs')}</li> : null}
            {proofUrls.map((p) => (
              <li key={p.id} className="rounded-md border border-gray-200 p-2 text-xs">
                {p.url && /^image\//.test(p.mime) ? <a href={p.url} target="_blank" rel="noreferrer" className="block"><img src={p.url} alt={p.fileName} className="h-28 w-full rounded object-cover" /></a> : null}
                <p className="mt-1 truncate text-gray-700">{p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{p.fileName}</a> : p.fileName}</p>
                <p className="font-mono text-[10px] text-gray-400">{fmtDate(p.createdAt)} · sha256 {p.sha256.slice(0, 10)}…</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <h3 className="font-display text-sm font-semibold">{t('history')}</h3>
        <ul className="mt-2 divide-y divide-gray-100">
          {audit.length === 0 ? <li className="py-2 text-sm text-gray-400">—</li> : null}
          {audit.map((a) => { const af = (a.after ?? {}) as Record<string, unknown>; return <li key={a.id} className="flex justify-between gap-2 py-1.5 text-xs"><span><span className="font-mono font-semibold text-gray-800">{a.action}</span>{typeof af.status === 'string' ? <span className="ml-2 text-gray-600">{t(`status.${af.status as never}`)}</span> : null}{typeof af.reason === 'string' && af.reason ? <span className="ml-2 text-gray-500">{af.reason}</span> : null}</span><span className="font-mono text-gray-400">{new Date(a.at).toLocaleString('ru-RU')}</span></li>; })}
        </ul>
      </Card>
    </div>
  );
}
