import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Building2, Search, UserPlus, Users } from 'lucide-react';
import { CONTACT_KINDS, DEAL_SOURCES, can } from '@finance-os/core';
import { listContacts, listDealManagers } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Table, Td, Th, cn } from '@/components/ui';
import { fmtDate } from '@/components/property';
import { createContactAction } from './actions';

/* CRM Tower — клиентская база (docs/20 §11.14): один клиент — много сделок, PII по праву, импорт из Excel на /migration. */

const PAGE = 100;
const STAGE_TONE: Record<string, 'green' | 'red' | 'blue' | 'gray'> = { WON: 'green', LOST: 'red' };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; manager?: string; owners?: string; page?: string; error?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'deal.view')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('contacts');
  const tD = await getTranslations('deals');
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  const [rows, managers] = await Promise.all([
    listContacts(ctx, { ...(sp.q ? { q: sp.q } : {}), ...(sp.manager ? { managerId: sp.manager } : {}), ownersOnly: sp.owners === '1', take: PAGE + 1, skip: (page - 1) * PAGE }),
    listDealManagers(ctx),
  ]);
  const hasNext = rows.length > PAGE; if (hasNext) rows.pop();
  const managerName = new Map(managers.map((m) => [m.id, m.fullName]));
  const href = (extra: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ q: sp.q, manager: sp.manager, owners: sp.owners, ...extra })) if (v) p.set(k, v); const s = p.toString(); return `/contacts${s ? `?${s}` : ''}`; };

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} meta={<Badge tone="gray">{t('count', { n: rows.length })}</Badge>} actions={<Link href="/migration" className="text-sm font-medium text-brand-600 hover:underline">{t('importLink')}</Link>} />
      {sp.error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : t('error.GENERIC')}</div> : null}

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1"><Label htmlFor="q">{t('search')}</Label><div className="relative"><Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-gray-400" /><Input id="q" name="q" defaultValue={sp.q ?? ''} placeholder={t('searchHint')} className="pl-8" /></div></div>
        <div><Label htmlFor="m">{t('manager')}</Label><Select id="m" name="manager" defaultValue={sp.manager ?? ''}><option value="">{t('allManagers')}</option>{managers.map((m) => (<option key={m.id} value={m.id}>{m.fullName}</option>))}</Select></div>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700"><input type="checkbox" name="owners" value="1" defaultChecked={sp.owners === '1'} className="h-4 w-4 rounded border-gray-300" />{t('ownersOnly')}</label>
        <Button type="submit" variant="outline">{t('apply')}</Button>
      </form>

      {rows.length === 0 ? <EmptyState icon={<Users />} text={t('empty')} /> : (
        <Table>
          <thead><tr><Th>{t('fields.name')}</Th><Th>{t('fields.phone')}</Th><Th>{t('fields.email')}</Th><Th>{t('fields.source')}</Th><Th>{t('fields.manager')}</Th><Th className="text-right">{t('fields.deals')}</Th><Th>{t('fields.lastStage')}</Th><Th>{t('fields.lastTouch')}</Th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <Td><Link href={`/contacts/${c.id}`} className="font-medium text-ink-900 hover:text-brand-600">{c.displayName}</Link>{c.company ? <span className="ml-2 text-xs text-gray-500">{c.company}</span> : null}{c.ownerId ? <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-emerald-700"><Building2 className="h-3 w-3" />{t('isOwner')}</span> : null}{c.tags.map((tag) => (<span key={tag} className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{tag}</span>))}</Td>
                <Td className="font-mono text-xs">{c.phone ?? '—'}</Td>
                <Td className="text-xs text-gray-600">{c.email ?? '—'}</Td>
                <Td className="text-xs">{c.source ? tD(`source.${c.source}`) : '—'}</Td>
                <Td className="text-xs text-gray-600">{c.managerId ? (managerName.get(c.managerId) ?? '—') : '—'}</Td>
                <Td className="text-right font-mono text-xs">{c.dealsActive}<span className="text-gray-400"> / {c.dealsTotal}</span></Td>
                <Td>{c.lastStage ? <Badge tone={STAGE_TONE[c.lastStage] ?? 'blue'}>{tD(`stage.${c.lastStage}`)}</Badge> : <span className="text-xs text-gray-400">—</span>}</Td>
                <Td className={cn('font-mono text-xs', c.lastTouchAt && Date.now() - c.lastTouchAt.getTime() > 30 * 86_400_000 ? 'text-amber-600' : 'text-gray-600')}>{fmtDate(c.lastTouchAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {page > 1 || hasNext ? (
        <div className="flex items-center justify-between text-sm text-gray-600">
          {page > 1 ? <Link href={href({ page: String(page - 1) })} className="rounded-md bg-gray-100 px-3 py-1.5 hover:bg-gray-200">← {t('prevPage')}</Link> : <span />}
          <span className="font-mono text-xs text-gray-400">{t('pageN', { n: page })}</span>
          {hasNext ? <Link href={href({ page: String(page + 1) })} className="rounded-md bg-gray-100 px-3 py-1.5 hover:bg-gray-200">{t('nextPage')} →</Link> : <span />}
        </div>
      ) : null}

      {can(ctx, 'deal.manage') ? (
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><UserPlus className="h-4 w-4 text-brand-500" />{t('new.title')}</h3>
          <p className="mt-1 text-xs text-gray-500">{t('new.hint')}</p>
          <form action={createContactAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div><Label htmlFor="c-name">{t('fields.name')} *</Label><Input id="c-name" name="displayName" required /></div>
            <div><Label htmlFor="c-kind">{t('fields.kind')}</Label><Select id="c-kind" name="kind" defaultValue="PERSON">{CONTACT_KINDS.map((k) => (<option key={k} value={k}>{t(`kind.${k}`)}</option>))}</Select></div>
            <div><Label htmlFor="c-phone">{t('fields.phone')}</Label><Input id="c-phone" name="phone" type="tel" placeholder="+998 90 123 45 67" /></div>
            <div><Label htmlFor="c-email">{t('fields.email')}</Label><Input id="c-email" name="email" type="email" /></div>
            <div><Label htmlFor="c-company">{t('fields.company')}</Label><Input id="c-company" name="company" /></div>
            <div><Label htmlFor="c-pos">{t('fields.position')}</Label><Input id="c-pos" name="position" /></div>
            <div><Label htmlFor="c-src">{t('fields.source')}</Label><Select id="c-src" name="source" defaultValue=""><option value="">—</option>{DEAL_SOURCES.map((s) => (<option key={s} value={s}>{tD(`source.${s}`)}</option>))}</Select></div>
            <div><Label htmlFor="c-tags">{t('fields.tags')}</Label><Input id="c-tags" name="tags" placeholder={t('tagsHint')} /></div>
            <div className="sm:col-span-2 lg:col-span-3"><Label htmlFor="c-notes">{t('fields.notes')}</Label><Input id="c-notes" name="notes" /></div>
            <div className="self-end"><Button type="submit">{t('new.create')}</Button></div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
