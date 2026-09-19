import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, ArrowLeft, Building2, Handshake, History, Merge, Pencil } from 'lucide-react';
import { CONTACT_KINDS, DEAL_SOURCES, NotFoundError } from '@finance-os/core';
import { getContact, listContacts } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Label, PageHeader, Select } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';
import { mergeContactsAction, updateContactAction } from '../actions';

/* CRM Tower — карточка клиента: контакты, сделки, история активностей, собственник, правка, слияние дублей. */

const STAGE_TONE: Record<string, 'green' | 'red' | 'blue'> = { WON: 'green', LOST: 'red' };
function Row({ k, v }: { k: string; v: React.ReactNode }) { return (<div className="flex items-start justify-between gap-3 text-sm"><dt className="text-gray-500">{k}</dt><dd className="text-right text-gray-900">{v}</dd></div>); }

export default async function ContactPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireTenantContext();
  const { id } = await params; const sp = await searchParams;
  const t = await getTranslations('contacts'); const tD = await getTranslations('deals'); const tO = await getTranslations('owners');
  let data: Awaited<ReturnType<typeof getContact>>;
  try { data = await getContact(ctx, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const { contact: c, deals, activities, owner } = data;
  const sameName = data.canMerge ? (await listContacts(ctx, { q: c.displayName.split(/\s+/)[0] ?? c.displayName, take: 20 })).filter((x) => x.id !== c.id) : [];
  const active = deals.filter((d) => !['WON', 'LOST'].includes(d.stage));

  return (
    <div className="space-y-5">
      <PageHeader
        title={c.displayName}
        meta={<span className="flex flex-wrap items-center gap-2"><Badge tone="gray">{t(`kind.${c.kind}`)}</Badge>{c.company ? <span className="text-sm text-gray-500">{c.company}{c.position ? ` · ${c.position}` : ''}</span> : null}{c.source ? <Badge tone="blue">{tD(`source.${c.source}`)}</Badge> : null}{c.tags.map((tag) => (<span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{tag}</span>))}</span>}
        actions={<div className="flex gap-2"><Link href="/contacts" className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200"><ArrowLeft className="h-4 w-4" />{t('back')}</Link>{data.canEdit ? <Link href={`/deals/new?contact=${c.id}`} className="inline-flex items-center gap-1 rounded-md bg-ink-900 px-3 py-1.5 text-sm font-medium text-white"><Handshake className="h-4 w-4" />{t('newDeal')}</Link> : null}</div>}
      />
      {sp.error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : t('error.GENERIC')}</div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="font-display text-sm font-semibold">{t('card.contacts')}</h3>
          <dl className="mt-3 space-y-1.5">
            <Row k={t('fields.phone')} v={<span className="font-mono">{c.phone ?? '—'}</span>} />
            {c.phoneAlt ? <Row k={t('fields.phoneAlt')} v={<span className="font-mono">{c.phoneAlt}</span>} /> : null}
            <Row k={t('fields.email')} v={c.email ?? '—'} />
            <Row k={t('fields.manager')} v={c.managerName ?? '—'} />
            <Row k={t('fields.lastTouch')} v={fmtDate(c.lastTouchAt)} />
            <Row k={t('card.created')} v={fmtDate(c.createdAt)} />
          </dl>
          {!data.pii ? <p className="mt-2 text-[11px] text-gray-400">{t('piiHidden')}</p> : null}
          {c.notes ? <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700 whitespace-pre-line">{c.notes}</p> : null}
          {owner ? (
            <div className="mt-4 rounded-md border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-sm">
              <p className="flex items-center gap-1 font-medium text-emerald-800"><Building2 className="h-4 w-4" />{t('card.owner')}</p>
              <p className="mt-1 text-xs text-gray-700">{owner.displayName} · {tO(`contract.${owner.managementContractStatus}`)} · {owner.units.map((u) => (<Link key={u.id} href={`/property/units/${u.id}`} className="ml-1 font-mono text-brand-600 hover:underline">{u.unitNo}</Link>))}</p>
            </div>
          ) : null}
        </Card>

        <Card>
          <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Handshake className="h-4 w-4 text-brand-500" />{t('card.deals')}</h3><Badge tone="gray">{t('card.dealsCount', { active: active.length, total: deals.length })}</Badge></div>
          {deals.length === 0 ? <p className="mt-3 text-sm text-gray-400">{t('card.noDeals')}</p> : (
            <ul className="mt-3 divide-y divide-gray-100">
              {deals.slice(0, 12).map((d) => (
                <li key={d.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-2"><span><Link href={`/deals/${d.id}`} className="font-mono text-xs text-brand-600 hover:underline">{d.number}</Link><span className="ml-2 text-xs text-gray-500">{tD(`product.${d.product}`)}</span>{d.unitNo ? <span className="ml-2 font-mono text-xs">{d.unitNo}</span> : null}</span><Badge tone={STAGE_TONE[d.stage] ?? 'blue'}>{tD(`stage.${d.stage}`)}</Badge></div>
                  <p className="mt-0.5 text-xs text-gray-500">{d.managerName}{d.nextAction ? ` · ${d.nextAction}` : ''}{d.nextActionAt ? ` · ${fmtDate(d.nextActionAt)}` : ''}{d.expectedRateMinor != null ? ` · ${fmtRate(d.expectedRateMinor, 'USD')}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><History className="h-4 w-4 text-brand-500" />{t('card.history')}</h3>
          {activities.length === 0 ? <p className="mt-3 text-sm text-gray-400">{t('card.noHistory')}</p> : (
            <ul className="mt-3 space-y-2 text-sm">
              {activities.map((a) => (<li key={a.id}><span className="font-mono text-[10px] text-gray-400">{fmtDate(a.happenedAt)}</span> <Badge tone="gray">{tD(`activity.${a.kind}`)}</Badge>{a.dealNumber ? <span className="ml-1 font-mono text-[10px] text-gray-500">{a.dealNumber}</span> : null}{a.unitNo ? <span className="ml-1 font-mono text-[10px] text-gray-500">{a.unitNo}</span> : null}<p className="text-gray-800">{a.note}</p></li>))}
            </ul>
          )}
        </Card>
      </div>

      {data.canEdit ? (
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Pencil className="h-4 w-4 text-brand-500" />{t('edit.title')}</h3>
          <form action={updateContactAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="id" value={c.id} />
            <div><Label htmlFor="e-name">{t('fields.name')} *</Label><Input id="e-name" name="displayName" defaultValue={c.displayName} required /></div>
            <div><Label htmlFor="e-kind">{t('fields.kind')}</Label><Select id="e-kind" name="kind" defaultValue={c.kind}>{CONTACT_KINDS.map((k) => (<option key={k} value={k}>{t(`kind.${k}`)}</option>))}</Select></div>
            <div><Label htmlFor="e-phone">{t('fields.phone')}</Label><Input id="e-phone" name="phone" type="tel" defaultValue={data.pii ? (c.phone ?? '') : ''} disabled={!data.pii} /></div>
            <div><Label htmlFor="e-phone2">{t('fields.phoneAlt')}</Label><Input id="e-phone2" name="phoneAlt" type="tel" defaultValue={data.pii ? (c.phoneAlt ?? '') : ''} disabled={!data.pii} /></div>
            <div><Label htmlFor="e-email">{t('fields.email')}</Label><Input id="e-email" name="email" type="email" defaultValue={data.pii ? (c.email ?? '') : ''} disabled={!data.pii} /></div>
            <div><Label htmlFor="e-company">{t('fields.company')}</Label><Input id="e-company" name="company" defaultValue={c.company ?? ''} /></div>
            <div><Label htmlFor="e-pos">{t('fields.position')}</Label><Input id="e-pos" name="position" defaultValue={c.position ?? ''} /></div>
            <div><Label htmlFor="e-src">{t('fields.source')}</Label><Select id="e-src" name="source" defaultValue={c.source ?? ''}><option value="">—</option>{DEAL_SOURCES.map((s) => (<option key={s} value={s}>{tD(`source.${s}`)}</option>))}</Select></div>
            <div><Label htmlFor="e-tags">{t('fields.tags')}</Label><Input id="e-tags" name="tags" defaultValue={c.tags.join('; ')} /></div>
            <div className="sm:col-span-2"><Label htmlFor="e-notes">{t('fields.notes')}</Label><Input id="e-notes" name="notes" defaultValue={c.notes ?? ''} /></div>
            <div className="self-end"><Button type="submit" variant="outline">{t('edit.save')}</Button></div>
          </form>
        </Card>
      ) : null}

      {data.canMerge && sameName.length ? (
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Merge className="h-4 w-4 text-brand-500" />{t('merge.title')}</h3>
          <p className="mt-1 text-xs text-gray-500">{t('merge.hint')}</p>
          <form action={mergeContactsAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="keepId" value={c.id} />
            <div className="min-w-72"><Label htmlFor="m-id">{t('merge.pick')}</Label><Select id="m-id" name="mergeId" required>{sameName.map((x) => (<option key={x.id} value={x.id}>{x.displayName} · {x.phone ?? x.email ?? '—'} · {t('card.dealsCount', { active: x.dealsActive, total: x.dealsTotal })}</option>))}</Select></div>
            <Button type="submit" variant="outline">{t('merge.submit')}</Button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
