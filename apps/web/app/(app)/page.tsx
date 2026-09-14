import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { CheckSquare, ListTodo, ShoppingCart, Store } from 'lucide-react';
import { listMyPendingApprovals, prisma } from '@finance-os/db';
import { requireSessionUser, requireTenantContext } from '@/lib/session';
import { Button, Card, PageHeader, StatCard } from '@/components/ui';

export default async function HomePage() {
  const user = await requireSessionUser();
  const ctx = await requireTenantContext();
  const t = await getTranslations('home');

  const [pendingApprovals, openPrs, pendingVendors, openTasks] = await Promise.all([
    listMyPendingApprovals(ctx).then((rows) => rows.length),
    prisma.purchaseRequest.count({
      where: { tenantId: ctx.tenantId, status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED', 'RECEIVED', 'INVOICED'] } },
    }),
    prisma.vendor.count({ where: { tenantId: ctx.tenantId, status: 'PENDING_VERIFICATION' } }),
    prisma.task.count({ where: { tenantId: ctx.tenantId, status: { in: ['OPEN', 'IN_PROGRESS', 'OVERDUE'] } } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={t('welcome', { name: user.fullName })} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('pendingApprovals')}
          value={pendingApprovals}
          icon={<CheckSquare />}
          tone={pendingApprovals > 0 ? 'warning' : 'default'}
        />
        <StatCard label={t('openPrs')} value={openPrs} icon={<ShoppingCart />} />
        <StatCard
          label={t('pendingVendors')}
          value={pendingVendors}
          icon={<Store />}
          tone={pendingVendors > 0 ? 'warning' : 'default'}
        />
        <StatCard label={t('openTasks')} value={openTasks} icon={<ListTodo />} />
      </div>

      <Card title={t('quick')}>
        <div className="flex flex-wrap gap-2">
          <Link href="/pr/new">
            <Button>{t('newPr')}</Button>
          </Link>
          <Link href="/approvals">
            <Button variant="outline">{t('goApprovals')}</Button>
          </Link>
          <Link href="/vendors">
            <Button variant="outline">{t('goVendors')}</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
