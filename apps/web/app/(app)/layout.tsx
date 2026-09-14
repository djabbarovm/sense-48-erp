import Link from 'next/link';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import {
  Banknote,
  Building2,
  CheckSquare,
  FileCheck,
  FileText,
  Landmark,
  LayoutDashboard,
  ListTodo,
  LogOut,
  PieChart,
  Settings,
  ShoppingCart,
  Store,
  Wallet,
} from 'lucide-react';
import { can, type PermissionCode } from '@finance-os/core';
import { listUserTenants } from '@finance-os/db';
import { logoutAction, switchTenantAction } from '@/lib/auth-actions';
import { requireSessionUser, requireTenantContext } from '@/lib/session';
import { Button } from '@/components/ui';

interface NavItem {
  key: string;
  href: string;
  icon: ReactNode;
  permission?: PermissionCode;
}

const ICON = 'h-[18px] w-[18px]';

const NAV: NavItem[] = [
  { key: 'dashboard', href: '/', icon: <LayoutDashboard className={ICON} />, permission: 'dashboard.ops' },
  { key: 'approvals', href: '/approvals', icon: <CheckSquare className={ICON} /> },
  { key: 'purchaseRequests', href: '/pr', icon: <ShoppingCart className={ICON} />, permission: 'pr.view' },
  { key: 'vendors', href: '/vendors', icon: <Store className={ICON} />, permission: 'vendor.view' },
  { key: 'contracts', href: '/contracts', icon: <FileText className={ICON} />, permission: 'contract.view' },
  { key: 'invoices', href: '/invoices', icon: <FileCheck className={ICON} />, permission: 'invoice.create' },
  { key: 'payments', href: '/payments', icon: <Wallet className={ICON} />, permission: 'payment.view' },
  { key: 'batches', href: '/batches', icon: <Banknote className={ICON} />, permission: 'batch.create' },
  { key: 'bank', href: '/bank', icon: <Landmark className={ICON} />, permission: 'bank.import' },
  { key: 'budget', href: '/budget', icon: <PieChart className={ICON} />, permission: 'budget.manage' },
  { key: 'tasks', href: '/tasks', icon: <ListTodo className={ICON} /> },
  { key: 'admin', href: '/admin', icon: <Settings className={ICON} />, permission: 'tenant.settings' },
];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireSessionUser();
  const ctx = await requireTenantContext();
  const tenants = await listUserTenants(user.id);
  const t = await getTranslations('nav');
  const tAuth = await getTranslations('auth');

  const items = NAV.filter((item) => !item.permission || can(ctx, item.permission));
  const initials = user.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col bg-ink-900 md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-sm font-bold text-white shadow-pop">
            F
          </div>
          <div className="text-[15px] font-semibold tracking-tight text-white">
            Finance<span className="text-brand-400">OS</span>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 pb-4">
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium text-slate-400 transition-colors hover:bg-ink-700 hover:text-white"
            >
              <span className="text-slate-500 transition-colors group-hover:text-brand-400">{item.icon}</span>
              {t(item.key)}
            </Link>
          ))}
        </nav>
        <div className="border-t border-ink-700 px-5 py-4">
          <p className="text-[11px] tracking-wider text-slate-500 uppercase">{ctx.tenantSlug}</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">{ctx.roles.join(' · ')}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-gray-200/80 bg-white/90 px-5 py-2.5 backdrop-blur">
          <form action={switchTenantAction} className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-gray-400" />
            <select
              name="tenant"
              defaultValue={ctx.tenantSlug}
              className="cursor-pointer rounded-lg border border-transparent bg-transparent py-1.5 pr-7 pl-2 text-sm font-medium text-gray-800 transition-colors hover:border-gray-200 hover:bg-gray-50 focus:border-brand-400 focus:outline-none"
              aria-label={t('tenantSwitcher')}
            >
              {tenants.map((tenant) => (
                <option key={tenant.slug} value={tenant.slug}>
                  {tenant.legalName}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm">
              OK
            </Button>
          </form>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
                {initials}
              </div>
              <span className="hidden text-sm font-medium text-gray-700 sm:block">{user.fullName}</span>
            </div>
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="sm" aria-label={tAuth('signOut')}>
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">{tAuth('signOut')}</span>
              </Button>
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-5 md:p-7">{children}</main>
      </div>
    </div>
  );
}
