import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Plus, Wrench } from 'lucide-react';
import { WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES, can } from '@finance-os/core';
import { listAssignees, listBuildings, listUnits, listWorkOrders } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Table, Td, Th, cn } from '@/components/ui';
import { fmtDate } from '@/components/property';
import { createWorkOrderAction } from './actions';
import { PRIORITY_TONE, STATUS_TONE } from './tones';

/* Wave 4 — заявки и инциденты (blueprint §12): очередь по SLA, создание, фильтры. */


export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ view?: string; error?: string; unit?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'workorder.view')) notFound();
  const sp = await searchParams;
  const t = await getTranslations('workorders');
  const view = sp.view ?? 'open';
  const filter = view === 'overdue' ? { overdueOnly: true } : view === 'mine' ? { mine: true } : view === 'done' ? { status: ['DONE', 'VERIFIED', 'CANCELLED'] as const } : { status: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'DONE'] as const };
  const [rows, assignees, buildings, units] = await Promise.all([
    listWorkOrders(ctx, { ...('status' in filter ? { status: [...filter.status] } : {}), ...('overdueOnly' in filter ? { overdueOnly: true } : {}), ...('mine' in filter ? { mine: true } : {}) }),
    can(ctx, 'workorder.manage') ? listAssignees(ctx) : Promise.resolve([]),
    listBuildings(ctx),
    can(ctx, 'workorder.create') ? listUnits(ctx) : Promise.resolve([]),
  ]);
  const overdueCount = rows.filter((r) => r.overdue).length;
  const tabs = ['open', 'overdue', 'mine', 'done'] as const;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        meta={<span className="flex items-center gap-2"><Badge tone="gray">{t('count', { n: rows.length })}</Badge>{overdueCount ? <Badge tone="red" dot>{t('overdueCount', { n: overdueCount })}</Badge> : null}</span>}
        actions={<div className="flex gap-1.5">{tabs.map((v) => (<Link key={v} href={`/workorders?view=${v}`} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', view === v ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>{t(`tab.${v}`)}</Link>))}</div>}
      />
      {sp.error ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t.has(`error.${sp.error}`) ? t(`error.${sp.error}`) : t('error.GENERIC')}</div> : null}

      {can(ctx, 'workorder.create') ? (
        <Card>
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Plus className="h-4 w-4" />{t('newTitle')}</h3>
          <form action={createWorkOrderAction} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="lg:col-span-2"><Label htmlFor="w-title">{t('fields.title')} *</Label><Input id="w-title" name="title" required /></div>
            <div><Label htmlFor="w-unit">{t('fields.unit')}</Label><Select id="w-unit" name="unitId" defaultValue={sp.unit ?? ''}><option value="">{t('fields.noUnit')}</option>{units.map((u) => (<option key={u.id} value={u.id}>{u.unitNo}</option>))}</Select></div>
            <div><Label htmlFor="w-building">{t('fields.building')}</Label><Select id="w-building" name="buildingId" defaultValue=""><option value="">—</option>{buildings.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}</Select></div>
            <div><Label htmlFor="w-cat">{t('fields.category')}</Label><Select id="w-cat" name="category" defaultValue="OTHER">{WORK_ORDER_CATEGORIES.map((c) => (<option key={c} value={c}>{t(`category.${c}`)}</option>))}</Select></div>
            <div><Label htmlFor="w-prio">{t('fields.priority')}</Label><Select id="w-prio" name="priority" defaultValue="NORMAL">{WORK_ORDER_PRIORITIES.map((p) => (<option key={p} value={p}>{t(`priority.${p}`)} · {t('slaHours', { h: { LOW: 168, NORMAL: 72, HIGH: 24, CRITICAL: 4 }[p] })}</option>))}</Select></div>
            <div className="lg:col-span-2"><Label htmlFor="w-desc">{t('fields.description')}</Label><Input id="w-desc" name="description" /></div>
            <div><Label htmlFor="w-loc">{t('fields.location')}</Label><Input id="w-loc" name="location" placeholder={t('fields.locationPlaceholder')} /></div>
            {assignees.length ? <div><Label htmlFor="w-assignee">{t('fields.assignee')}</Label><Select id="w-assignee" name="assigneeId" defaultValue=""><option value="">{t('fields.unassigned')}</option>{assignees.map((a) => (<option key={a.id} value={a.id}>{a.fullName}</option>))}</Select></div> : null}
            <div className="self-end"><Button type="submit">{t('create')}</Button></div>
          </form>
        </Card>
      ) : null}

      {rows.length === 0 ? <EmptyState icon={<Wrench />} text={t('empty')} /> : (
        <Table>
          <thead><tr><Th>{t('fields.number')}</Th><Th>{t('fields.title')}</Th><Th>{t('fields.unit')}</Th><Th>{t('fields.priority')}</Th><Th>{t('fields.status')}</Th><Th>{t('fields.sla')}</Th><Th>{t('fields.assignee')}</Th></tr></thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} className={cn('group', w.overdue ? 'bg-red-50/40' : '')}>
                <Td><Link href={`/workorders/${w.id}`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">{w.number}</Link></Td>
                <Td><span className="font-medium text-gray-900">{w.title}</span><span className="ml-2 text-xs text-gray-500">{t(`category.${w.category}`)}</span></Td>
                <Td>{w.unitId ? <Link href={`/property/units/${w.unitId}`} className="font-mono font-semibold text-ink-900 hover:text-brand-600">{w.unitNo}</Link> : <span className="text-xs text-gray-500">{w.buildingName ?? '—'}</span>}</Td>
                <Td><Badge tone={PRIORITY_TONE[w.priority]}>{t(`priority.${w.priority}`)}</Badge></Td>
                <Td><Badge tone={STATUS_TONE[w.status]} dot>{t(`status.${w.status}`)}</Badge></Td>
                <Td className={cn('font-mono text-xs', w.overdue ? 'font-semibold text-red-600' : 'text-gray-600')}>{w.hoursLeft == null ? fmtDate(w.slaDueAt) : w.overdue ? t('overdueBy', { h: Math.abs(w.hoursLeft) }) : t('hoursLeft', { h: w.hoursLeft })}</Td>
                <Td className="text-xs text-gray-600">{w.assigneeName ?? <span className="text-red-600">{t('fields.unassigned')}</span>}{w.contractorName ? ` · ${w.contractorName}` : ''}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
