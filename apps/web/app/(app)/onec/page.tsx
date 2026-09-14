import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { BookOpenCheck } from 'lucide-react';
import { can, hasRole } from '@finance-os/core';
import { listAccountMappings, prisma } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Button, Card, Input, PageHeader, Table, Td, Th } from '@/components/ui';
import { PostedForm } from './posted-form';
import { upsertMappingAction } from './actions';

export default async function OnecPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'report.export') && !hasRole(ctx, 'ADMIN')) notFound();
  const t = await getTranslations('onec');

  const [mappings, categories] = await Promise.all([
    listAccountMappings(ctx),
    prisma.category.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { code: 'asc' } }),
  ]);
  const mappingByCat = new Map(mappings.map((m) => [m.categoryId, m]));
  const canMapping = hasRole(ctx, 'ADMIN');
  const currentPeriod = new Date().toISOString().slice(0, 7);

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />
      <p className="-mt-3 flex max-w-3xl items-start gap-2 text-sm text-gray-500">
        <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0" /> {t('intro')}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t('exportTitle')}>
          <p className="mb-2 text-xs text-gray-500">{t('exportHint')}</p>
          <form method="post" action="/onec/export" className="flex items-center gap-2">
            <Input name="period" type="month" defaultValue={currentPeriod} required className="w-auto" />
            <Button type="submit">{t('exportBtn')}</Button>
          </form>
        </Card>
        <PostedForm />
      </div>

      <Card title={t('mappingTitle')}>
        <p className="mb-3 text-xs text-gray-500">{t('mappingHint')}</p>
        <Table>
          <thead>
            <tr>
              <Th>{t('category')}</Th>
              <Th>{t('accountCode')}</Th>
              <Th>{t('vatAccountCode')}</Th>
              {canMapping ? <Th /> : null}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              const mapping = mappingByCat.get(category.id);
              return (
                <tr key={category.id}>
                  <Td className="font-medium">
                    {category.name} <span className="font-mono text-xs text-gray-400">{category.code}</span>
                  </Td>
                  {canMapping ? (
                    <Td colSpan={3}>
                      <form action={upsertMappingAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="categoryId" value={category.id} />
                        <Input name="accountCode" defaultValue={mapping?.accountCode ?? ''} placeholder="9420" required className="w-24 font-mono" />
                        <Input name="vatAccountCode" defaultValue={mapping?.vatAccountCode ?? ''} placeholder="4410" className="w-24 font-mono" />
                        <Button type="submit" variant="outline" size="sm">
                          OK
                        </Button>
                      </form>
                    </Td>
                  ) : (
                    <>
                      <Td className="font-mono">{mapping?.accountCode ?? '—'}</Td>
                      <Td className="font-mono">{mapping?.vatAccountCode ?? '—'}</Td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
