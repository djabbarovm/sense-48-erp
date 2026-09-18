import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, ArrowLeft, Camera, CheckCheck, Play, RotateCcw, UserCheck, XCircle } from 'lucide-react';
import { NotFoundError, can } from '@finance-os/core';
import { createStorageFromEnv } from '@finance-os/adapters';
import { getWorkOrder, listAssignees } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, PageHeader, Select, cn } from '@/components/ui';
import { fmtDate } from '@/components/property';
import { PRIORITY_TONE, STATUS_TONE } from '../tones';
import { transitionWorkOrderAction, uploadProofAction } from '../actions';

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3 text-[13px]"><dt className="text-gray-500">{k}</dt><dd className="text-right font-medium text-gray-900">{v}</dd></div>;
}

export default async function WorkOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'workorder.view')) notFound();
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getTranslations('workorders');
  let data: Awaited<ReturnType<typeof getWorkOrder>>;
  try {
    data = await getWorkOrder(ctx, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { workOrder: w, proofs, audit, triggers, canUpload } = data;
  const assignees = triggers.includes('assign') ? await listAssignees(ctx) : [];
  const storage = createStorageFromEnv();
  const proofUrls = await Promise.all(proofs.map(async (p) => ({ ...p, url: await storage.getSignedUrl(p.fileKey).catch(() => null) })));

  return (
    <div className="space-y-5">
      <PageHeader
        title={<span className="font-mono">{w.number}</span>}
        meta={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[w.status]} dot>{t(`status.${w.status}`)}</Badge><Badge tone={PRIORITY_TONE[w.priority]}>{t(`priority.${w.priority}`)}</Badge>{w.overdue ? <Badge tone="red">{t('overdue')}</Badge> : null}</span>}
        actions={<Link href="/workorders" className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"><ArrowLeft className="h-4 w-4" />{t('toList')}</Link>}
      />
      {error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${error}`) ? t(`error.${error}`) : t('error.GENERIC')}</div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="text-[15px] font-semibold text-gray-900">{w.title}</h3>
          {w.description ? <p className="mt-1 text-sm text-gray-700">{w.description}</p> : null}
          <dl className="mt-3 space-y-1.5">
            <Row k={t('fields.category')} v={t(`category.${w.category}`)} />
            <Row k={t('fields.unit')} v={w.unitId ? <Link href={`/property/units/${w.unitId}`} className="font-mono text-brand-600 hover:underline">{w.unitNo}</Link> : (w.buildingName ?? '—')} />
            {w.location ? <Row k={t('fields.location')} v={w.location} /> : null}
            <Row k={t('fields.reporter')} v={w.reporterName} />
            <Row k={t('fields.assignee')} v={w.assigneeName ?? <span className="text-red-600">{t('fields.unassigned')}</span>} />
            {w.contractorName ? <Row k={t('fields.contractor')} v={w.contractorName} /> : null}
            <Row k={t('fields.sla')} v={<span className={cn('font-mono', w.overdue ? 'text-red-600' : '')}>{fmtDate(w.slaDueAt)}{w.hoursLeft != null ? ` · ${w.overdue ? t('overdueBy', { h: Math.abs(w.hoursLeft) }) : t('hoursLeft', { h: w.hoursLeft })}` : ''}</span>} />
            <Row k={t('fields.created')} v={fmtDate(w.createdAt)} />
            {w.startedAt ? <Row k={t('fields.started')} v={fmtDate(w.startedAt)} /> : null}
            {w.doneAt ? <Row k={t('fields.done')} v={fmtDate(w.doneAt)} /> : null}
            {w.verifiedAt ? <Row k={t('fields.verified')} v={fmtDate(w.verifiedAt)} /> : null}
            {w.cancelReason ? <Row k={t('fields.cancelReason')} v={w.cancelReason} /> : null}
          </dl>
        </Card>

        <Card>
          <h3 className="font-display text-sm font-semibold">{t('actions')}</h3>
          <div className="mt-3 space-y-3">
            {triggers.includes('assign') ? (
              <form action={transitionWorkOrderAction} className="space-y-2 rounded-md bg-gray-50 p-3">
                <input type="hidden" name="id" value={w.id} /><input type="hidden" name="trigger" value="assign" />
                <div><Label htmlFor="a-assignee">{t('fields.assignee')}</Label><Select id="a-assignee" name="assigneeId" defaultValue={w.assigneeId ?? ''} required><option value="">—</option>{assignees.map((a) => (<option key={a.id} value={a.id}>{a.fullName}</option>))}</Select></div>
                <div><Label htmlFor="a-contractor">{t('fields.contractor')}</Label><Input id="a-contractor" name="contractorName" defaultValue={w.contractorName ?? ''} /></div>
                <Button type="submit" size="sm" variant="outline"><UserCheck className="h-3.5 w-3.5" />{t('trigger.assign')}</Button>
              </form>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {triggers.includes('start') ? <form action={transitionWorkOrderAction}><input type="hidden" name="id" value={w.id} /><input type="hidden" name="trigger" value="start" /><Button type="submit" size="sm"><Play className="h-3.5 w-3.5" />{t('trigger.start')}</Button></form> : null}
              {triggers.includes('done') ? <form action={transitionWorkOrderAction}><input type="hidden" name="id" value={w.id} /><input type="hidden" name="trigger" value="done" /><Button type="submit" size="sm"><CheckCheck className="h-3.5 w-3.5" />{t('trigger.done')}</Button></form> : null}
              {triggers.includes('verify') ? <form action={transitionWorkOrderAction}><input type="hidden" name="id" value={w.id} /><input type="hidden" name="trigger" value="verify" /><Button type="submit" size="sm" disabled={proofs.length === 0} title={proofs.length === 0 ? t('error.PROOF_REQUIRED') : undefined}><CheckCheck className="h-3.5 w-3.5" />{t('trigger.verify')}</Button></form> : null}
            </div>
            {w.status === 'DONE' && !triggers.includes('verify') && can(ctx, 'workorder.verify') ? <p className="text-xs text-gray-500">{t('selfVerifyHint')}</p> : null}
            {triggers.includes('reopen') ? (
              <form action={transitionWorkOrderAction} className="flex items-end gap-2"><input type="hidden" name="id" value={w.id} /><input type="hidden" name="trigger" value="reopen" /><div className="flex-1"><Label htmlFor="r-reason">{t('fields.reason')}</Label><Input id="r-reason" name="reason" required /></div><Button type="submit" size="sm" variant="outline"><RotateCcw className="h-3.5 w-3.5" />{t('trigger.reopen')}</Button></form>
            ) : null}
            {triggers.includes('cancel') ? (
              <form action={transitionWorkOrderAction} className="flex items-end gap-2"><input type="hidden" name="id" value={w.id} /><input type="hidden" name="trigger" value="cancel" /><div className="flex-1"><Label htmlFor="c-reason">{t('fields.reason')}</Label><Input id="c-reason" name="reason" required /></div><Button type="submit" size="sm" variant="danger"><XCircle className="h-3.5 w-3.5" />{t('trigger.cancel')}</Button></form>
            ) : null}
            {triggers.length === 0 ? <p className="text-sm text-gray-400">{t('noActions')}</p> : null}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2"><Camera className="h-4 w-4 text-brand-500" /><h3 className="font-display text-sm font-semibold">{t('proofs')}</h3></div>
          <p className="mt-1 text-xs text-gray-500">{t('proofsHint')}</p>
          {canUpload ? (
            <form action={uploadProofAction} className="mt-3 flex items-center gap-2">
              <input type="hidden" name="id" value={w.id} />
              <Input type="file" name="file" accept="image/*" required className="flex-1" aria-label={t('proofFile')} />
              <Button type="submit" size="sm" variant="outline">{t('upload')}</Button>
            </form>
          ) : null}
          <ul className="mt-3 grid grid-cols-2 gap-2">
            {proofUrls.length === 0 ? <li className="col-span-2 text-sm text-gray-400">{t('noProofs')}</li> : null}
            {proofUrls.map((p) => (
              <li key={p.id} className="rounded-md border border-gray-200 p-2 text-xs">
                {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="block"><img src={p.url} alt={p.fileName} className="h-28 w-full rounded object-cover" /></a> : null}
                <p className="mt-1 truncate text-gray-700">{p.fileName}</p>
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
