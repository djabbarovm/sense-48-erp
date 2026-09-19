import Link from 'next/link';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import {
  Banknote,
  BookOpenCheck,
  Briefcase,
  CalendarCheck,
  Building2,
  CheckSquare,
  Crown,
  FileCheck,
  FileText,
  FileWarning,
  Gauge,
  History,
  HandCoins,
  Hourglass,
  Landmark,
  LayoutDashboard,
  ListTodo,
  LogOut,
  PartyPopper,
  PieChart,
  Scale,
  Settings,
  ShoppingCart,
  Store,
  TrendingUp,
  Upload,
  UsersRound,
  Wallet,
  Sunrise,
  Building,
  Handshake,
  FileSignature,
  Activity,
  Bot,
  Wrench,
  Sparkles,
  Coins,
  BadgePercent,
  Award,
  Home,
  Users,
  Sun,
  BarChart3 } from 'lucide-react';
import { can, type PermissionCode } from '@finance-os/core';
import { listUserTenants } from '@finance-os/db';
import { logoutAction, switchTenantAction } from '@/lib/auth-actions';
import { requireSessionUser, requireTenantContext } from '@/lib/session';
import { Button } from '@/components/ui';

type Section = 'daily' | 'commercial' | 'property' | 'finance' | 'reports' | 'admin';

interface NavItem {
  key: string;
  href: string;
  icon: ReactNode;
  section: Section;
  permission?: PermissionCode;
}

const ICON = 'h-[18px] w-[18px]';
const SECTION_ORDER: Section[] = ['daily', 'commercial', 'property', 'finance', 'reports', 'admin'];

// Навигация сгруппирована по разделам (docs/06). Права по-прежнему фильтруют каждый пункт —
// группировка и «фокус» ниже только меняют ПОДАЧУ, доступ не расширяют и не сужают.
const NAV: NavItem[] = [
  // ── Мой день / обзоры ──
  { key: 'me', href: '/me', icon: <Sun className={ICON} />, section: 'daily', permission: 'deal.view' },
  { key: 'ceoMorning', href: '/ceo', icon: <Sunrise className={ICON} />, section: 'daily', permission: 'dashboard.owner' },
  { key: 'controlRoom', href: '/property/today', icon: <Activity className={ICON} />, section: 'daily', permission: 'property.view' },
  { key: 'dashboard', href: '/', icon: <LayoutDashboard className={ICON} />, section: 'daily', permission: 'dashboard.ops' },
  { key: 'ownerDash', href: '/dashboard', icon: <Crown className={ICON} />, section: 'daily', permission: 'dashboard.owner' },
  { key: 'ownerPortal', href: '/owner', icon: <Home className={ICON} />, section: 'daily', permission: 'owner.portal' },
  { key: 'approvals', href: '/approvals', icon: <CheckSquare className={ICON} />, section: 'daily' },
  { key: 'tasks', href: '/tasks', icon: <ListTodo className={ICON} />, section: 'daily' },
  // ── Коммерция ──
  { key: 'deals', href: '/deals', icon: <Handshake className={ICON} />, section: 'commercial', permission: 'deal.view' },
  { key: 'contacts', href: '/contacts', icon: <Users className={ICON} />, section: 'commercial', permission: 'deal.view' },
  { key: 'crmAnalytics', href: '/crm/analytics', icon: <BarChart3 className={ICON} />, section: 'commercial', permission: 'deal.view' },
  { key: 'leases', href: '/leases', icon: <FileSignature className={ICON} />, section: 'commercial', permission: 'lease.view' },
  { key: 'mall', href: '/mall', icon: <Store className={ICON} />, section: 'commercial', permission: 'mall.view' },
  { key: 'commissions', href: '/commissions', icon: <BadgePercent className={ICON} />, section: 'commercial', permission: 'commission.view' },
  { key: 'bonuses', href: '/bonuses', icon: <Award className={ICON} />, section: 'commercial', permission: 'bonus.own' },
  // ── Недвижимость / эксплуатация ──
  { key: 'property', href: '/property', icon: <Building className={ICON} />, section: 'property', permission: 'property.view' },
  { key: 'owners', href: '/property/owners', icon: <Users className={ICON} />, section: 'property', permission: 'property.manage' },
  { key: 'workorders', href: '/workorders', icon: <Wrench className={ICON} />, section: 'property', permission: 'workorder.view' },
  { key: 'services', href: '/services', icon: <Sparkles className={ICON} />, section: 'property', permission: 'service.view' },
  { key: 'workbot', href: '/property/actions', icon: <Bot className={ICON} />, section: 'property', permission: 'action.draft' },
  // ── Финансы ──
  { key: 'purchaseRequests', href: '/pr', icon: <ShoppingCart className={ICON} />, section: 'finance', permission: 'pr.view' },
  { key: 'vendors', href: '/vendors', icon: <Store className={ICON} />, section: 'finance', permission: 'vendor.view' },
  { key: 'contracts', href: '/contracts', icon: <FileText className={ICON} />, section: 'finance', permission: 'contract.view' },
  { key: 'invoices', href: '/invoices', icon: <FileCheck className={ICON} />, section: 'finance', permission: 'invoice.create' },
  { key: 'payments', href: '/payments', icon: <Wallet className={ICON} />, section: 'finance', permission: 'payment.view' },
  { key: 'batches', href: '/batches', icon: <Banknote className={ICON} />, section: 'finance', permission: 'batch.create' },
  { key: 'bank', href: '/bank', icon: <Landmark className={ICON} />, section: 'finance', permission: 'bank.import' },
  { key: 'ap', href: '/ap', icon: <Hourglass className={ICON} />, section: 'finance', permission: 'payment.view' },
  { key: 'ar', href: '/ar', icon: <HandCoins className={ICON} />, section: 'finance', permission: 'payment.view' },
  { key: 'rent', href: '/rent', icon: <Coins className={ICON} />, section: 'finance', permission: 'rent.view' },
  { key: 'house', href: '/house', icon: <Landmark className={ICON} />, section: 'finance', permission: 'house.view' },
  { key: 'events', href: '/events', icon: <PartyPopper className={ICON} />, section: 'finance', permission: 'payment.view' },
  { key: 'forecast', href: '/forecast', icon: <TrendingUp className={ICON} />, section: 'finance', permission: 'payment.view' },
  { key: 'budget', href: '/budget', icon: <PieChart className={ICON} />, section: 'finance', permission: 'budget.manage' },
  { key: 'documents', href: '/documents/health', icon: <FileWarning className={ICON} />, section: 'finance', permission: 'payment.view' },
  { key: 'tax', href: '/tax', icon: <Scale className={ICON} />, section: 'finance', permission: 'payment.view' },
  { key: 'payroll', href: '/payroll', icon: <UsersRound className={ICON} />, section: 'finance', permission: 'payroll.prepare' },
  // ── Отчёты и контроль ──
  { key: 'close', href: '/close', icon: <CalendarCheck className={ICON} />, section: 'reports', permission: 'close.run' },
  { key: 'controls', href: '/controls', icon: <Gauge className={ICON} />, section: 'reports', permission: 'dashboard.ops' },
  { key: 'portfolio', href: '/portfolio', icon: <Briefcase className={ICON} />, section: 'reports' },
  { key: 'audit', href: '/audit', icon: <History className={ICON} />, section: 'reports', permission: 'audit.view' },
  { key: 'onec', href: '/onec', icon: <BookOpenCheck className={ICON} />, section: 'reports', permission: 'report.export' },
  // ── Администрирование ──
  { key: 'migration', href: '/migration', icon: <Upload className={ICON} />, section: 'admin', permission: 'budget.manage' },
  { key: 'admin', href: '/admin', icon: <Settings className={ICON} />, section: 'admin', permission: 'tenant.settings' },
];

// Роли с узким операционным контуром: им показываем компактный «фокус» + сворачиваемый полный список.
// Широкие роли (владелец, финансы, админ) видят полный сгруппированный список сразу.
const FOCUSED_ROLES = new Set(['CALL_CENTER', 'COMMERCIAL_MANAGER', 'BROKER', 'COMMERCIAL_DIRECTOR', 'OPERATIONS_MANAGER', 'MARKETING', 'PROPERTY_OWNER', 'CEO']);
const PRIMARY_NAV: Record<string, string[]> = {
  CALL_CENTER: ['me', 'deals', 'contacts', 'tasks'],
  COMMERCIAL_MANAGER: ['me', 'deals', 'contacts', 'property', 'tasks'],
  BROKER: ['me', 'deals', 'contacts', 'property'],
  COMMERCIAL_DIRECTOR: ['me', 'deals', 'contacts', 'crmAnalytics', 'commissions'],
  OPERATIONS_MANAGER: ['controlRoom', 'workorders', 'services', 'property', 'tasks'],
  MARKETING: ['property', 'deals', 'mall', 'crmAnalytics'],
  PROPERTY_OWNER: ['ownerPortal'],
  CEO: ['ceoMorning', 'controlRoom', 'deals', 'payments', 'audit'],
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireSessionUser();
  const ctx = await requireTenantContext();
  const tenants = await listUserTenants(user.id);
  const t = await getTranslations('nav');
  const tAuth = await getTranslations('auth');

  const items = NAV.filter((item) => !item.permission || can(ctx, item.permission));
  const byKey = new Map(items.map((i) => [i.key, i]));
  const sections = SECTION_ORDER.map((s) => ({ s, list: items.filter((i) => i.section === s) })).filter((g) => g.list.length);

  // «Фокус»: пользователь только с узкими ролями получает короткое меню + сворачиваемый полный список.
  const isFocused = ctx.roles.length > 0 && ctx.roles.every((r) => FOCUSED_ROLES.has(r));
  const focusKeys = isFocused
    ? [...new Set(ctx.roles.flatMap((r) => PRIMARY_NAV[r] ?? []))].filter((k) => byKey.has(k))
    : [];
  const focusItems = focusKeys.map((k) => byKey.get(k)!);
  const mobileKeys = (focusKeys.length ? focusKeys : ['me', 'deals', 'contacts', 'owners', 'controlRoom'])
    .filter((k) => byKey.has(k))
    .slice(0, 5);
  const mobileItems = mobileKeys.map((k) => byKey.get(k)!);

  const navLink = (item: NavItem) => (
    <Link
      key={item.key}
      href={item.href}
      className="group flex items-center gap-3 rounded-md px-3 py-2 text-[13.5px] font-medium text-slate-400 transition-colors hover:bg-ink-800 hover:text-white"
    >
      <span className="text-slate-600 transition-colors group-hover:text-volt-500">{item.icon}</span>
      {t(item.key)}
    </Link>
  );
  const sectionBlock = (
    <div className="space-y-3">
      {sections.map(({ s, list }) => (
        <div key={s} className="space-y-0.5">
          <p className="px-3 pt-1 pb-0.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-slate-600 uppercase">{t(`section.${s}`)}</p>
          {list.map(navLink)}
        </div>
      ))}
    </div>
  );

  const initials = user.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside className="pixel-grid hidden w-60 shrink-0 flex-col bg-ink-950 md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="grid h-8 w-8 grid-cols-3 grid-rows-3 gap-[2px]" aria-hidden>
            {[0, 2, 4, 6, 8].map((i) => (
              <span key={i} className="rounded-[1px] bg-volt-500" style={{ gridArea: `${Math.floor(i / 3) + 1} / ${(i % 3) + 1}` }} />
            ))}
          </div>
          <div className="font-display text-[15px] font-bold tracking-tight text-white uppercase">
            D<span className="text-volt-500">MS</span>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {focusItems.length ? (
            <>
              <div className="space-y-0.5">
                <p className="px-3 pt-1 pb-0.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-volt-600 uppercase">{t('focus')}</p>
                {focusItems.map(navLink)}
              </div>
              <details className="mt-3 group">
                <summary className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[12px] font-medium text-slate-500 hover:text-white marker:content-['']">
                  <span className="transition-transform group-open:rotate-90">›</span>
                  {t('allSections')}
                </summary>
                <div className="mt-2">{sectionBlock}</div>
              </details>
            </>
          ) : (
            sectionBlock
          )}
        </nav>
        <div className="border-t border-ink-800 px-5 py-4">
          <p className="font-mono text-[11px] tracking-[0.18em] text-volt-600 uppercase">{ctx.tenantSlug}</p>
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
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-900 font-mono text-xs font-semibold text-volt-500">
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
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 pb-20 md:p-7">{children}</main>
        {/* Нижняя навигация на телефоне — под роль пользователя (фокус-набор), с запасным набором (docs/21 §8) */}
        {mobileItems.length > 0 && (
          <nav
            className="fixed inset-x-0 bottom-0 z-30 grid border-t border-gray-200 bg-white/95 backdrop-blur md:hidden"
            style={{ gridTemplateColumns: `repeat(${mobileItems.length}, minmax(0, 1fr))` }}
            aria-label={t('mobileNav')}
          >
            {mobileItems.map((item) => (
              <Link key={item.key} href={item.href} className="flex flex-col items-center gap-0.5 py-2 text-[10px] text-gray-600 hover:text-brand-600">{item.icon}<span>{t(item.key)}</span></Link>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
