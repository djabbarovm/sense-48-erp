import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, hasRole } from '@finance-os/core';
import { requireTenantContext } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { ImportCard } from './import-card';
import type { MigrationType } from './actions';

const FINANCE: MigrationType[] = ['vendors', 'contracts', 'open_ap', 'open_ar', 'employees', 'budgets'];
const PROPERTY: MigrationType[] = ['inventory', 'floorplan'];

export default async function MigrationPage() {
  const ctx = await requireTenantContext();
  // видимость = budget.manage (Owner/Lead) + ADMIN; сами импортёры проверяют свои права
  const finance = hasRole(ctx, 'ADMIN') || hasRole(ctx, 'FINANCE_OPS_LEAD', 'OWNER');
  const property = can(ctx, 'property.manage');
  if (!finance && !property) notFound();
  const t = await getTranslations('migration');
  const order = [...(finance ? FINANCE : []), ...(property ? PROPERTY : [])];

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />
      <p className="-mt-3 max-w-3xl text-sm text-gray-500">{t('intro')}</p>
      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
        {order.map((type, i) => (
          <ImportCard key={type} type={type} order={i + 1} />
        ))}
      </div>
    </div>
  );
}
