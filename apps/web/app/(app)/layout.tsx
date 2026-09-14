import Link from 'next/link';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { can, type PermissionCode } from '@finance-os/core';
import { listUserTenants } from '@finance-os/db';
import { logoutAction, switchTenantAction } from '@/lib/auth-actions';
import { requireSessionUser, requireTenantContext } from '@/lib/session';
import { Button, Select } from '@/components/ui';

interface NavItem {
  key: string;
  href: string;
  permission?: PermissionCode;
}

const NAV: NavItem[] = [
  { key: 'dashboard', href: '/', permission: 'dashboard.ops' },
  { key: 'approvals', href: '/approvals' },
  { key: 'purchaseRequests', href: '/pr', permission: 'pr.view' },
  { key: 'vendors', href: '/vendors', permission: 'vendor.view' },
  { key: 'contracts', href: '/contracts', permission: 'contract.view' },
  { key: 'invoices', href: '/invoices', permission: 'invoice.create' },
  { key: 'payments', href: '/payments', permission: 'payment.view' },
  { key: 'bank', href: '/bank', permission: 'bank.import' },
  { key: 'budget', href: '/budget', permission: 'budget.manage' },
  { key: 'tasks', href: '/tasks' },
  { key: 'admin', href: '/admin', permission: 'tenant.settings' },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireSessionUser();
  const ctx = await requireTenantContext();
  const tenants = await listUserTenants(user.id);
  const t = await getTranslations('nav');
  const tAuth = await getTranslations('auth');

  const items = NAV.filter((item) => !item.permission || can(ctx, item.permission));

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r border-gray-200 bg-white p-4 md:block">
        <div className="mb-6 text-lg font-semibold text-brand">Finance OS</div>
        <nav className="space-y-1">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-4 py-2">
          <form action={switchTenantAction} className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{t('tenantSwitcher')}</span>
            <Select name="tenant" defaultValue={ctx.tenantSlug} className="w-auto">
              {tenants.map((tenant) => (
                <option key={tenant.slug} value={tenant.slug}>
                  {tenant.legalName}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="outline">
              OK
            </Button>
          </form>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{user.fullName}</span>
            <form action={logoutAction}>
              <Button type="submit" variant="ghost">
                {tAuth('signOut')}
              </Button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-4">{children}</main>
      </div>
    </div>
  );
}
