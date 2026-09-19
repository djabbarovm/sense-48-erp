import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Calculator, Clock, Users } from 'lucide-react';
import { can } from '@finance-os/core';
import { getOwnerPipeline, listOwnersAdmin } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { MANAGEMENT_CONTRACT_STATUSES, OWNER_STAGES, type OwnerStage } from '@finance-os/core';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th, cn } from '@/components/ui';
import { fmtDate } from '@/components/property';
import { linkOwnerUserAction } from './actions';
import { setManagementContractStatusAction } from '../../house/actions';
import { CONTRACT_TONE } from '../../house/tones';
import { OWNER_STAGE_TONE } from './tones';
import { moveOwnerStageAction } from './actions';

/* Wave 4b — реестр собственников и привязка учёток Owner Portal (property.manage). */

const VIEWS = ['pipeline', 'registry', 'analytics'] as const;

export default async function OwnersAdminPage({ searchParams }: { searchParams: Promise<{ error?: string; view?: string; manager?: string; q?: string }> }) {
  const ctx = await requireTenantContext();
  const manage = can(ctx, 'property.manage');
  if (!manage && !can(ctx, 'owner.pipeline')) notFound();
  const sp = await searchParams; const { error } = sp;
  const t = await getTranslations('owners');
  const view = (VIEWS as readonly string[]).includes(sp.view ?? '') ? (sp.view as (typeof VIEWS)[number]) : manage ? 'registry' : 'pipeline';
  const owners = manage && view === 'registry' ? await listOwnersAdmin(ctx) : [];
  const pipeline = view !== 'registry' ? await getOwnerPipeline(ctx, { ...(sp.manager ? { managerId: sp.manager } : {}), ...(sp.q ? { q: sp.q } : {}) }) : null;
  const q = (v: string) => `/property/owners?view=${v}${sp.manager ? `&manager=${sp.manager}` : ''}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ''}`;
  const stageCols: OwnerStage[] = ['LEAD', 'CONTACTED', 'CALC_SHOWN', 'CONSENT', 'CONTRACT_SENT', 'SIGNED', 'HANDED_OVER'];
  if (view !== 'registry' && pipeline) {
    return (
      <div className="space-y-5">
        <PageHeader
          title={t('title')}
          meta={<span className="flex flex-wrap items-center gap-2"><Badge tone="gray">{t('count', { n: pipeline.rows.length })}</Badge>{pipeline.overdue ? <Badge tone="red" dot>{t('pipeline.overdue', { n: pipeline.overdue })}</Badge> : null}{pipeline.noNextAction ? <Badge tone="yellow">{t('pipeline.noNext', { n: pipeline.noNextAction })}</Badge> : null}{pipeline.calcNotShown ? <Badge tone="yellow">{t('pipeline.calcNotShown', { n: pipeline.calcNotShown })}</Badge> : null}</span>}
          actions={<div className="flex flex-wrap gap-1.5">{VIEWS.filter((v) => manage || v !== 'registry').map((v) => (<Link key={v} href={q(v)} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', view === v ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>{t(`view.${v}`)}</Link>))}</div>}
        />
        {error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${error}`) ? t(`error.${error}`) : t('error.GENERIC')}</div> : null}
        <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="view" value={view} />
          <Input name="q" defaultValue={sp.q ?? ''} placeholder={t('pipeline.search')} className="w-56" aria-label={t('pipeline.search')} />
          <Select name="manager" defaultValue={sp.manager ?? ''} aria-label={t('pipeline.manager')}><option value="">{t('pipeline.allManagers')}</option>{pipeline.managers.map((m) => (<option key={m.id} value={m.id}>{m.fullName}</option>))}</Select>
          <Button type="submit" variant="outline" size="sm">{t('pipeline.apply')}</Button>
        </form>
        {view === 'pipeline' ? (
          <>
            <p className="-mt-2 text-xs text-gray-500">{t('pipeline.hint')}</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {stageCols.map((stage) => { const col = pipeline.byStage.find((b) => b.stage === stage)!; return (
                <Card key={stage}>
                  <div className="mb-2 flex items-center justify-between"><Badge tone={OWNER_STAGE_TONE[stage]} dot>{t(`stage.${stage}`)}</Badge><span className="font-mono text-xs text-gray-500">{col.rows.length}</span></div>
                  <ul className="space-y-2">
                    {col.rows.slice(0, 12).map((o) => (
                      <li key={o.id} className={cn('rounded-md border px-2.5 py-2 text-sm', o.overdue ? 'border-red-200 bg-red-50/40' : 'border-gray-100')}>
                        <div className="flex items-start justify-between gap-2"><Link href={`/property/owners/${o.id}`} className="font-medium text-ink-900 hover:text-brand-600">{o.displayName}</Link><span className="font-mono text-[10px] text-gray-400">{o.daysInStage}{t('pipeline.d')}</span></div>
                        <p className="mt-0.5 font-mono text-[11px] text-gray-500">{o.unitNos.slice(0, 4).join(', ')}{o.unitNos.length > 4 ? ` +${o.unitNos.length - 4}` : ''} · {t(`segment.${o.segment}`)}</p>
                        {o.nextAction ? <p className={cn('mt-1 flex items-center gap-1 text-xs', o.overdue ? 'text-red-700' : 'text-gray-600')}><Clock className="h-3 w-3" />{o.nextAction}{o.nextActionAt ? ` · ${fmtDate(o.nextActionAt)}` : ''}</p> : <p className="mt-1 text-xs text-amber-600">{t('pipeline.noNextOne')}</p>}
                        {!o.calcShown && ['CONTACTED', 'CONSENT', 'CONTRACT_SENT'].includes(o.stage) ? <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-600"><Calculator className="h-3 w-3" />{t('pipeline.showCalc')}</p> : null}
                        {o.managerName ? <p className="mt-0.5 text-[10px] text-gray-400">{o.managerName}</p> : null}
                      </li>
                    ))}
                    {col.rows.length > 12 ? <li className="text-center text-xs text-gray-400">+{col.rows.length - 12}</li> : null}
                    {col.rows.length === 0 ? <li className="text-xs text-gray-300">—</li> : null}
                  </ul>
                </Card>
              ); })}
            </div>
            {pipeline.byStage.find((b) => b.stage === 'LOST')!.rows.length ? (
              <Card>
                <div className="flex items-center justify-between"><Badge tone="red">{t('stage.LOST')}</Badge><span className="text-xs text-gray-500">{pipeline.lostReasons.map((r) => `${t(`lost.${r.reason}`)}: ${r.count}`).join(' · ')}</span></div>
                <ul className="mt-2 flex flex-wrap gap-2 text-xs">{pipeline.byStage.find((b) => b.stage === 'LOST')!.rows.slice(0, 20).map((o) => (<li key={o.id}><Link href={`/property/owners/${o.id}`} className="text-gray-700 hover:text-brand-600">{o.displayName}</Link>{manage ? <form action={moveOwnerStageAction} className="inline"><input type="hidden" name="ownerId" value={o.id} /><input type="hidden" name="stage" value="CONTACTED" /><input type="hidden" name="back" value={q('pipeline')} /><button className="ml-1 text-brand-600 hover:underline">{t('pipeline.reopen')}</button></form> : null}</li>))}</ul>
              </Card>
            ) : null}
          </>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="font-display text-sm font-semibold">{t('analytics.conversion')}</h3>
              <p className="mt-1 text-xs text-gray-500">{t('analytics.conversionHint')}</p>
              <Table>
                <thead><tr><Th>{t('analytics.segment')}</Th><Th className="text-right">{t('analytics.total')}</Th><Th className="text-right">{t('analytics.reached')}</Th><Th className="text-right">{t('analytics.lost')}</Th><Th className="text-right">{t('analytics.pct')}</Th></tr></thead>
                <tbody>{pipeline.conversion.map((c) => (<tr key={c.segment} className={c.segment === 'ALL' ? 'font-semibold' : ''}><Td>{c.segment === 'ALL' ? t('analytics.all') : t(`segment.${c.segment}`)}</Td><Td className="text-right font-mono">{c.total}</Td><Td className="text-right font-mono text-emerald-600">{c.reached}</Td><Td className="text-right font-mono text-red-600">{c.lost}</Td><Td className="text-right font-mono">{c.pct == null ? '—' : `${c.pct}%`}</Td></tr>))}</tbody>
              </Table>
            </Card>
            <Card>
              <h3 className="font-display text-sm font-semibold">{t('analytics.stages')}</h3>
              <ul className="mt-3 space-y-1.5 text-sm">{OWNER_STAGES.map((st) => { const n = pipeline.byStage.find((b) => b.stage === st)!.rows.length; return (<li key={st} className="flex items-center justify-between"><Badge tone={OWNER_STAGE_TONE[st]}>{t(`stage.${st}`)}</Badge><span className="font-mono">{n}</span></li>); })}</ul>
              <h4 className="mt-4 text-xs font-semibold text-gray-700">{t('analytics.lostReasons')}</h4>
              {pipeline.lostReasons.length === 0 ? <p className="text-xs text-gray-400">—</p> : <ul className="mt-1 space-y-0.5 text-xs">{pipeline.lostReasons.map((r) => (<li key={r.reason} className="flex justify-between"><span>{t(`lost.${r.reason}`)}</span><span className="font-mono">{r.count}</span></li>))}</ul>}
            </Card>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} meta={<Badge tone="gray">{t('count', { n: owners.length })}</Badge>} actions={<div className="flex flex-wrap gap-1.5">{VIEWS.map((v) => (<Link key={v} href={q(v)} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', view === v ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>{t(`view.${v}`)}</Link>))}</div>} />
      <p className="-mt-3 max-w-3xl text-sm text-gray-500">{t('intro')}</p>
      {error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${error}`) ? t(`error.${error}`) : t('error.GENERIC')}</div> : null}
      {owners.length === 0 ? <EmptyState icon={<Users />} text={t('empty')} /> : (
        <Table>
          <thead><tr><Th>{t('owner')}</Th><Th>{t('units')}</Th><Th>{t('consents')}</Th><Th>{t('contact')}</Th><Th>{t('contract.title')}</Th><Th>{t('portalUser')}</Th></tr></thead>
          <tbody>
            {owners.map((o) => (
              <tr key={o.id} className="group align-top">
                <Td><Link href={`/property/owners/${o.id}`} className="font-medium text-gray-900 hover:text-brand-600">{o.displayName}</Link><span className="ml-2 text-xs text-gray-500">{t(`kind.${o.kind}`)}</span></Td>
                <Td className="font-mono text-xs">{o.units.join(', ') || '—'}</Td>
                <Td className="text-xs"><span className={o.managementConsent ? 'text-emerald-600' : 'text-gray-400'}>{t('c.management')}</span> · <span className={o.listingConsent ? 'text-emerald-600' : 'text-gray-400'}>{t('c.listing')}</span> · <span className={o.marketingConsent ? 'text-emerald-600' : 'text-gray-400'}>{t('c.marketing')}</span></Td>
                <Td className="font-mono text-xs text-gray-600">{o.contactPhone ?? '—'}{o.contactEmail ? <><br />{o.contactEmail}</> : null}</Td>
                <Td>
                  <div className="flex items-center gap-1.5"><Badge tone={CONTRACT_TONE[o.managementContractStatus]} dot>{t(`contract.${o.managementContractStatus}`)}</Badge>{o.managementContractSignedAt ? <span className="font-mono text-[10px] text-gray-400">{fmtDate(o.managementContractSignedAt)}</span> : null}</div>
                  <form action={setManagementContractStatusAction} className="mt-1 flex items-center gap-1"><input type="hidden" name="ownerId" value={o.id} /><Select name="status" defaultValue={o.managementContractStatus} aria-label={t('contract.title')} className="w-32">{MANAGEMENT_CONTRACT_STATUSES.map((st) => (<option key={st} value={st}>{t(`contract.${st}`)}</option>))}</Select><Input name="signedAt" type="date" aria-label={t('contract.signedAt')} className="w-36" /><Button type="submit" size="sm" variant="outline">{t('contract.set')}</Button></form>
                </Td>
                <Td>
                  {o.userEmail ? (
                    <form action={linkOwnerUserAction} className="flex items-center gap-2"><input type="hidden" name="ownerId" value={o.id} /><input type="hidden" name="unlink" value="1" /><Badge tone="green" dot>{o.userEmail}</Badge><button className="text-xs text-red-600 hover:underline">{t('unlink')}</button></form>
                  ) : (
                    <form action={linkOwnerUserAction} className="flex items-center gap-1.5"><input type="hidden" name="ownerId" value={o.id} /><Input name="email" type="email" placeholder={t('emailPlaceholder')} className="w-56" aria-label={t('emailPlaceholder')} required /><Button type="submit" size="sm" variant="outline">{t('link')}</Button></form>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
