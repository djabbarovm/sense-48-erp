import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { can } from '@finance-os/core';
import { CheckCircle2, Circle, Flame, ListTodo, ShieldCheck, ShoppingCart, Store, Zap } from 'lucide-react';
import { prisma } from '@finance-os/db';
import { requireSessionUser, requireTenantContext } from '@/lib/session';
import { getDailyMission } from '@/lib/quests';
import { Button, Card, PageHeader, StatCard, cn } from '@/components/ui';
import { CutoffCountdown } from '@/components/game/Countdown';

export default async function HomePage() {
  const user = await requireSessionUser();
  const ctx = await requireTenantContext();
  // Роли недвижимости без финансового дашборда попадают на «Пульт» MDS Property (blueprint §9)
  if (!can(ctx, 'dashboard.ops') && can(ctx, 'property.view')) redirect('/property/today');
  const t = await getTranslations('home');
  const tm = await getTranslations('mission');

  const [mission, openPrs, pendingVendors] = await Promise.all([
    getDailyMission(ctx),
    prisma.purchaseRequest.count({
      where: { tenantId: ctx.tenantId, status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'ORDERED', 'RECEIVED', 'INVOICED'] } },
    }),
    prisma.vendor.count({ where: { tenantId: ctx.tenantId, status: 'PENDING_VERIFICATION' } }),
  ]);
  const donePct = Math.round(mission.progress * 100);

  return (
    <div className="space-y-6">
      <PageHeader title={t('welcome', { name: user.fullName })} />

      {/* Игровой ряд: countdown + стрик + green flow */}
      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CutoffCountdown cutoff={mission.cutoff} label={tm('cutoffLabel')} doneLabel={tm('cutoffPassed')} />
        <StatCard
          label={tm('streak')}
          value={
            <span className="inline-flex items-center gap-2">
              {mission.streakDays}
              <Flame className={cn('h-6 w-6', mission.streakDays >= 7 ? 'text-orange-400' : 'text-slate-600')} />
            </span>
          }
          hint={tm('streakHint')}
          tone={mission.streakDays >= 7 ? 'success' : 'default'}
        />
        <StatCard
          label={tm('greenFlow')}
          value={`${mission.greenFlowPct}%`}
          hint={tm('greenFlowHint')}
          icon={<ShieldCheck />}
          tone={mission.greenFlowPct >= 90 ? 'success' : mission.greenFlowPct >= 70 ? 'warning' : 'danger'}
        />
      </div>

      {/* Квест дня */}
      <Card className="card-lift animate-rise">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <Zap className="h-4 w-4 text-volt-600" /> {tm('title')}
          </h2>
          <span className="tnum text-sm font-semibold text-gray-500">{donePct}%</span>
        </div>
        <div className="mb-4 h-2 overflow-hidden rounded-sm bg-gray-100">
          <div className="xpbar h-full rounded-sm transition-all duration-700" style={{ width: `${donePct}%` }} />
        </div>
        <ul className="stagger grid grid-cols-1 gap-2 sm:grid-cols-2">
          {mission.items.map((item) => (
            <li
              key={item.key}
              className={cn(
                'flex items-center gap-2.5 rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2 text-sm',
                item.done && 'quest-done',
              )}
            >
              {item.done ? (
                <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-volt-600" />
              ) : (
                <Circle className="h-4.5 w-4.5 shrink-0 text-gray-300" />
              )}
              <span className="flex-1">{tm(`quest.${item.key}`)}</span>
              {!item.done && item.count ? (
                <span className="tnum rounded-sm bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700">
                  {item.count}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {/* Операционные счётчики + быстрые действия */}
      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label={t('openPrs')} value={openPrs} icon={<ShoppingCart />} />
        <StatCard
          label={t('pendingVendors')}
          value={pendingVendors}
          icon={<Store />}
          tone={pendingVendors > 0 ? 'warning' : 'default'}
        />
      </div>

      <Card title={t('quick')} className="card-lift">
        <div className="flex flex-wrap gap-2">
          <Link href="/pr/new">
            <Button>{t('newPr')}</Button>
          </Link>
          <Link href="/approvals">
            <Button variant="outline">{t('goApprovals')}</Button>
          </Link>
          <Link href="/tasks">
            <Button variant="outline">
              <ListTodo className="h-4 w-4" /> {t('openTasks')}
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
