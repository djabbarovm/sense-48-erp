import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Bot, Check, ExternalLink, X } from 'lucide-react';
import { can } from '@finance-os/core';
import { listActionDrafts } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, PageHeader, cn } from '@/components/ui';
import { confirmActionDraftAction, createActionDraftAction, rejectActionDraftAction } from './actions';

/* P-12 WorkBot — «Черновики действий»: сообщение → structured draft → preview → подтвердить/отклонить (blueprint §1.9, §7). */

const TONE: Record<string, 'gray' | 'green' | 'red' | 'yellow' | 'blue'> = { DRAFT: 'blue', CONFIRMED: 'green', REJECTED: 'gray', FAILED: 'red', NEEDS_INFO: 'yellow' };

export default async function ActionDraftsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'action.draft')) notFound();
  const { error } = await searchParams;
  const t = await getTranslations('workbot');
  const drafts = await listActionDrafts(ctx);
  const open = drafts.filter((d) => d.status === 'DRAFT' || d.status === 'NEEDS_INFO');
  const done = drafts.filter((d) => d.status !== 'DRAFT' && d.status !== 'NEEDS_INFO');

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} meta={<Badge tone={open.length ? 'blue' : 'gray'}>{t('openCount', { n: open.length })}</Badge>} />
      <p className="-mt-3 max-w-3xl text-sm text-gray-500">{t('intro')}</p>
      {error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${error}`) ? t(`error.${error}`) : t('error.GENERIC')}</div> : null}

      <Card>
        <form action={createActionDraftAction} className="flex flex-wrap items-center gap-2">
          <Bot className="h-5 w-5 text-brand-500" />
          <Input name="text" required maxLength={1000} placeholder={t('placeholder')} className="min-w-64 flex-1" aria-label={t('message')} />
          <Button type="submit" size="sm">{t('makeDraft')}</Button>
        </form>
        <p className="mt-2 text-[11px] text-gray-400">{t('examples')}</p>
      </Card>

      <section>
        <h2 className="mb-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase">{t('openSection')}</h2>
        {open.length === 0 ? <p className="text-sm text-gray-400">{t('nothingOpen')}</p> : null}
        <div className="space-y-2">
          {open.map((d) => (
            <Card key={d.id} className={cn(d.status === 'NEEDS_INFO' ? 'border-amber-300 bg-amber-50/40' : '')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500">«{d.rawText}» · {d.createdByName} · {t(`source.${d.source}`)}{d.kind ? ` · ${t(`kind.${d.kind}`)}` : ''}{d.status === 'DRAFT' ? ` · ${t('confidence', { n: d.confidence })}` : ''}</p>
                  <p className="mt-1 text-sm font-medium text-gray-900">{d.preview}</p>
                </div>
                <div className="flex items-center gap-2">
                  {d.canConfirm ? <form action={confirmActionDraftAction}><input type="hidden" name="id" value={d.id} /><Button type="submit" size="sm"><Check className="h-3.5 w-3.5" />{t('confirm')}</Button></form> : d.status === 'DRAFT' ? <span className="text-xs text-gray-500">{t('needsRole', { p: d.kind ? t(`kind.${d.kind}`) : '' })}</span> : null}
                  <form action={rejectActionDraftAction} className="flex items-center gap-1"><input type="hidden" name="id" value={d.id} /><Input name="reason" placeholder={t('rejectReason')} className="w-40" aria-label={t('rejectReason')} /><Button type="submit" variant="outline" size="sm"><X className="h-3.5 w-3.5" />{t('reject')}</Button></form>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase">{t('historySection')}</h2>
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {done.length === 0 ? <li className="px-4 py-3 text-sm text-gray-400">—</li> : null}
          {done.slice(0, 30).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <span className="text-gray-500">«{d.rawText}»</span>
                <span className="ml-2 text-gray-800">{d.preview}</span>
                {d.error ? <span className="ml-2 font-mono text-xs text-red-600">{d.error}</span> : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={TONE[d.status] ?? 'gray'}>{t(`status.${d.status}`)}</Badge>
                {d.resultRef ? <Link href={d.resultRef} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"><ExternalLink className="h-3 w-3" />{t('open')}</Link> : null}
                <span className="font-mono text-[11px] text-gray-400">{d.confirmedByName ?? ''} {d.confirmedAt ? new Date(d.confirmedAt).toLocaleString('ru-RU') : ''}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
