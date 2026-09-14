import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { FileWarning, ShieldCheck } from 'lucide-react';
import { can } from '@finance-os/core';
import { HEALTH_ZONES, getDocumentHealth, type HealthItem, type HealthZone } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Card, EmptyState, PageHeader, StatCard } from '@/components/ui';

// куда ведёт drill-down по типу объекта
const OBJECT_LINK: Record<string, (id: string) => string> = {
  payment_request: () => '/payments',
  invoice: () => '/invoices',
  contract: (id) => `/contracts/${id}`,
  purchase_request: (id) => `/pr/${id}`,
  vendor: (id) => `/vendors/${id}`,
  advance: () => '/tasks',
};

const ZONE_TONE: Record<HealthZone, 'red' | 'yellow'> = {
  PAID_WITHOUT_SF: 'red',
  PAID_WITHOUT_ACT_SLA: 'red',
  EXPIRED_CONTRACTS: 'red',
  UNMATCHED_INVOICES: 'yellow',
  MISSING_POA: 'yellow',
  UNSIGNED_AMENDMENTS: 'yellow',
  ADVANCES_OVERDUE: 'red',
  TERMINATION_NOT_CLOSED: 'yellow',
  VENDOR_BANK_CHANGED: 'red',
};

export default async function DocumentHealthPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'payment.view')) notFound();
  const t = await getTranslations('health');

  const health = await getDocumentHealth(ctx);
  const total = Object.values(health).reduce((sum, zone) => sum + zone.length, 0);
  const critical = HEALTH_ZONES.filter((z) => ZONE_TONE[z] === 'red').reduce((sum, z) => sum + health[z].length, 0);

  const renderItem = (item: HealthItem) => {
    const href = OBJECT_LINK[item.objectType]?.(item.objectId);
    return (
      <li key={`${item.objectType}:${item.objectId}:${item.detail}`} className="flex flex-wrap items-center gap-2 rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2 text-sm">
        {href ? (
          <Link href={href} className="font-mono text-xs font-semibold text-brand-700 hover:underline">
            {item.label}
          </Link>
        ) : (
          <span className="font-mono text-xs font-semibold">{item.label}</span>
        )}
        <span className="flex-1 text-gray-600">{item.detail}</span>
        {item.ownerName ? <Badge tone="blue">{item.ownerName}</Badge> : null}
        {item.openTaskId ? (
          <Link href="/tasks">
            <Badge tone="yellow">{t('hasTask')}</Badge>
          </Link>
        ) : null}
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />

      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t('total')} value={total} icon={<FileWarning />} tone={total > 0 ? 'warning' : 'success'} />
        <StatCard label={t('critical')} value={critical} tone={critical > 0 ? 'danger' : 'success'} />
        <StatCard
          label={t('score')}
          value={total === 0 ? '100%' : `${Math.max(0, 100 - critical * 5 - (total - critical) * 2)}%`}
          icon={<ShieldCheck />}
          tone={critical === 0 ? 'success' : 'danger'}
          hint={t('scoreHint')}
        />
      </div>

      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
        {HEALTH_ZONES.map((zone) => (
          <Card key={zone} className="card-lift">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">{t(`zone.${zone}`)}</h2>
              <Badge tone={health[zone].length === 0 ? 'green' : ZONE_TONE[zone]}>{health[zone].length}</Badge>
            </div>
            {health[zone].length === 0 ? (
              <p className="text-sm text-gray-400">{t('clean')}</p>
            ) : (
              <ul className="space-y-1.5">{health[zone].slice(0, 8).map(renderItem)}</ul>
            )}
            {health[zone].length > 8 ? (
              <p className="mt-2 text-xs text-gray-400">{t('more', { count: health[zone].length - 8 })}</p>
            ) : null}
          </Card>
        ))}
      </div>
      {total === 0 ? <EmptyState text={t('allClean')} /> : null}
    </div>
  );
}
