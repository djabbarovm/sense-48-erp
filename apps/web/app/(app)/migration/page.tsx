import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { hasRole } from '@finance-os/core';
import { requireTenantContext } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { ImportCard } from './import-card';
import type { MigrationType } from './actions';

const ORDER: MigrationType[] = ['vendors', 'contracts', 'open_ap', 'open_ar', 'employees', 'budgets'];

export default async function MigrationPage() {
  const ctx = await requireTenantContext();
  // видимость = budget.manage (Owner/Lead) + ADMIN; сами импортёры проверяют свои права
  if (!hasRole(ctx, 'ADMIN') && !hasRole(ctx, 'FINANCE_OPS_LEAD', 'OWNER')) notFound();
  const t = await getTranslations('migration');

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />
      <p className="-mt-3 max-w-3xl text-sm text-gray-500">{t('intro')}</p>
      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
        {ORDER.map((type, i) => (
          <ImportCard key={type} type={type} order={i + 1} />
        ))}
      </div>
    </div>
  );
}
