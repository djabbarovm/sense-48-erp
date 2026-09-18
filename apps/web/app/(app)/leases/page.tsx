import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { can } from '@finance-os/core';
import { listLeases } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, cn } from '@/components/ui';
import { fmtDate, fmtRate } from '@/components/property';

/* Wave 2 — реестр договоров аренды: действующие, истекающие, расторгнутые (docs/20 §11.1). */

export default async function LeasesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'lease.view')) notFound();
  const { view = 'active' } = await searchParams;
  const t = await getTranslations('leases');
  const filter = view === 'expiring' ? { status: ['ACTIVE', 'EXPIRING'] as const, expiringWithinDays: 90 } : view === 'closed' ? { status: ['TERMINATED', 'DRAFT'] as const } : { status: ['ACTIVE', 'EXPIRING'] as const };
  const rows = await listLeases(ctx, { status: [...filter.status], ...('expiringWithinDays' in filter ? { expiringWithinDays: filter.expiringWithinDays } : {}) });
  const rent = rows.reduce((s, r) => s + (r.rentMinor ?? 0n), 0n);
  const tabs = ['active', 'expiring', 'closed'] as const;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        meta={<Badge tone="gray">{t('count', { n: rows.length })}</Badge>}
        actions={<div className="flex gap-1.5">{tabs.map((v) => (<Link key={v} href={`/leases?view=${v}`} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', view === v ? 'bg-ink-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}>{t(`tab.${v}`)}</Link>))}</div>}
      />
      {can(ctx, 'unit.finance.view') && view !== 'closed' ? <Card><p className="text-sm text-gray-600">{t('monthlyRent')}: <span className="font-mono font-semibold text-gray-900">{fmtRate(rent, 'USD')}</span></p></Card> : null}
      {rows.length === 0 ? <EmptyState text={t('empty')} /> : (
        <Table>
          <thead><tr><Th>{t('unit')}</Th><Th>{t('occupant')}</Th><Th>{t('type')}</Th><Th>{t('status')}</Th><Th>{t('period')}</Th><Th className="text-right">{t('rent')}</Th><Th>{t('deposit')}</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="group">
                <Td><Link href={`/property/units/${r.unitId}`} className="font-mono font-semibold text-ink-900 hover:text-brand-600">{r.unitNo}</Link><span className="ml-2 text-xs text-gray-400">{r.buildingName}</span></Td>
                <Td>{r.occupantName}{r.occupantContact ? <span className="ml-2 font-mono text-xs text-gray-400">{r.occupantContact}</span> : null}</Td>
                <Td>{t(`leaseType.${r.type}`)}</Td>
                <Td><Badge tone={r.status === 'ACTIVE' ? 'green' : r.status === 'EXPIRING' ? 'yellow' : r.status === 'TERMINATED' ? 'red' : 'gray'} dot>{t(`leaseStatus.${r.status}`)}</Badge>{r.endsInDays != null && r.status !== 'TERMINATED' ? <span className={cn('ml-2 text-xs', r.endsInDays <= 30 ? 'text-red-600' : 'text-gray-400')}>{t('endsIn', { n: r.endsInDays })}</span> : null}</Td>
                <Td className="text-xs text-gray-600">{fmtDate(r.startAt)} → {r.endAt ? fmtDate(r.endAt) : t('openEnded')}</Td>
                <Td className="text-right font-mono">{fmtRate(r.rentMinor, r.currency)}</Td>
                <Td className="text-xs">{r.depositMinor != null ? <span className={r.depositReceived ? 'text-emerald-600' : 'text-red-600'}>{fmtRate(r.depositMinor, r.currency)} · {r.depositReceived ? t('received') : t('notReceived')}</span> : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
