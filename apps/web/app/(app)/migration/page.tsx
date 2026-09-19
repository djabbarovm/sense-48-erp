import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, hasRole } from '@finance-os/core';
import { requireTenantContext } from '@/lib/session';
import { prisma } from '@finance-os/db';
import { PageHeader } from '@/components/ui';
import { ImportCard } from './import-card';
import { NATIVE_TYPES, type MigrationType } from './types';

const FINANCE: MigrationType[] = ['vendors', 'contracts', 'open_ap', 'open_ar', 'employees', 'budgets'];
const PROPERTY: MigrationType[] = ['inventory', 'floorplan'];

export default async function MigrationPage() {
  const ctx = await requireTenantContext();
  // видимость = budget.manage (Owner/Lead) + ADMIN; сами импортёры проверяют свои права
  const finance = hasRole(ctx, 'ADMIN') || hasRole(ctx, 'FINANCE_OPS_LEAD', 'OWNER');
  const property = can(ctx, 'property.manage');
  if (!finance && !property) notFound();
  const t = await getTranslations('migration');
  const order: MigrationType[] = [...(finance ? FINANCE : []), ...(property ? PROPERTY : [])];
  const categories = finance ? (await prisma.category.findMany({ where: { tenantId: ctx.tenantId }, select: { code: true, name: true }, orderBy: { code: 'asc' } })) : [];

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />
      <p className="-mt-3 max-w-3xl text-sm text-gray-500">{t('intro')}</p>
      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
        {order.map((type, i) => (
          <ImportCard key={type} type={type} order={i + 1} />
        ))}
      </div>
      {finance ? (
        <>
          <h2 className="mt-2 font-mono text-[11px] tracking-widest text-gray-500 uppercase">{t('nativeTitle')}</h2>
          <p className="-mt-3 max-w-3xl text-sm text-gray-500">{t('nativeIntro')}</p>
          <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
            {NATIVE_TYPES.map((type, i) => (
              <ImportCard key={type} type={type} order={order.length + i + 1} categories={categories} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
