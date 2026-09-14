import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { CalendarDays, Users } from 'lucide-react';
import { NotFoundError, can, formatMoney, hasRole, money } from '@finance-os/core';
import { getEvent, getEventPl, prisma, type DepositScheduleItem } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, Input, Meter, PageHeader, StatCard } from '@/components/ui';
import { eventTransitionAction, recordDepositAction, upsertBudgetLineAction } from '../actions';

const TONE = {
  DRAFT: 'gray',
  QUOTED: 'blue',
  CONFIRMED: 'green',
  IN_PROGRESS: 'blue',
  HELD: 'yellow',
  SETTLING: 'yellow',
  CLOSED: 'green',
  CANCELLED: 'gray',
} as const;

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantContext();
  const { id } = await params;
  const t = await getTranslations('events');

  let data: Awaited<ReturnType<typeof getEvent>>;
  try {
    data = await getEvent(ctx, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { event, budgetLines, payments, invoices, tasks } = data;
  const pl = await getEventPl(ctx, id);
  const [customer, categories] = await Promise.all([
    event.customerId ? prisma.customer.findUnique({ where: { id: event.customerId } }) : null,
    prisma.category.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, orderBy: { name: 'asc' } }),
  ]);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const schedule = (event.depositSchedule as unknown as DepositScheduleItem[]) ?? [];
  const canEdit = can(ctx, 'event.edit');
  const canConfirm = can(ctx, 'event.confirm');
  const canClose = can(ctx, 'event.close') || hasRole(ctx, 'OWNER');
  const openTasks = tasks.filter((task) => ['OPEN', 'IN_PROGRESS', 'OVERDUE'].includes(task.status));

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${event.number} · ${event.name}`}
        actions={<Badge tone={TONE[event.status]}>{t(`status.${event.status}`)}</Badge>}
      />
      <p className="-mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-500">
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="h-4 w-4" /> {event.eventDate.toISOString().slice(0, 10)}
        </span>
        {customer ? <span>{customer.legalName}</span> : null}
        <span className="inline-flex items-center gap-1">
          <Users className="h-4 w-4" /> {event.guestsActual ?? event.guestsPlanned ?? '—'}
        </span>
      </p>

      {/* P&L */}
      <div className="stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('pl.revenue')} value={formatMoney(money(pl.revenueInvoicedMinor > 0n ? pl.revenueInvoicedMinor : pl.revenueBudgetMinor, 'UZS'))} hint={t('pl.revenueHint', { budget: formatMoney(money(pl.revenueBudgetMinor, 'UZS')) })} />
        <StatCard label={t('pl.deposits')} value={formatMoney(money(pl.depositsReceivedMinor, 'UZS'))} hint={t('pl.arOut', { ar: formatMoney(money(pl.arOutstandingMinor, 'UZS')) })} />
        <StatCard
          label={t('pl.cost')}
          value={formatMoney(money(pl.actualMinor + pl.committedMinor, 'UZS'))}
          hint={t('pl.costHint', { budget: formatMoney(money(pl.costBudgetMinor, 'UZS')) })}
          tone={pl.actualMinor + pl.committedMinor > pl.costBudgetMinor && pl.costBudgetMinor > 0n ? 'danger' : 'default'}
        />
        <StatCard
          label={t('pl.margin')}
          value={formatMoney(money(pl.marginCurrentMinor, 'UZS'))}
          hint={t('pl.marginPlan', { plan: formatMoney(money(pl.marginPlanMinor, 'UZS')) })}
          tone={pl.marginCurrentMinor < 0n ? 'danger' : 'success'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Cost budget lines: plan vs committed vs actual */}
        <Card title={t('costLines')}>
          <ul className="space-y-3">
            {budgetLines.map((line) => {
              const cat = pl.costByCategory.find((c) => c.categoryId === line.categoryId);
              const used = (cat?.actualMinor ?? 0n) + (cat?.committedMinor ?? 0n);
              return (
                <li key={line.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{categoryName.get(line.categoryId) ?? '—'}</span>
                    <span className="money text-xs text-gray-500">
                      {formatMoney(money(used, 'UZS'))} / {formatMoney(money(line.plannedMinor, 'UZS'))}
                    </span>
                  </div>
                  <Meter value={Number(used / 100n)} max={Number(line.plannedMinor / 100n)} className="mt-1" />
                </li>
              );
            })}
          </ul>
          {canEdit && ['DRAFT', 'QUOTED', 'CONFIRMED'].includes(event.status) ? (
            <form action={upsertBudgetLineAction} className="mt-4 flex flex-wrap items-center gap-2">
              <input type="hidden" name="eventId" value={event.id} />
              <select name="categoryId" required className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm">
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Input name="planned" type="number" min="0" placeholder={t('planSoum')} required className="w-36" />
              <Button type="submit" variant="outline" size="sm">
                {t('addLine')}
              </Button>
            </form>
          ) : null}
        </Card>

        {/* Deposits + переходы */}
        <Card title={t('deposits')}>
          <ul className="space-y-2 text-sm">
            {schedule.map((item, i) => {
              const received = BigInt(item.received_minor ?? '0');
              const required = (event.revenueBudgetMinor * BigInt(Math.round(item.pct * 100))) / 10_000n;
              return (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2">
                  <span>
                    {item.pct}% · {t('due')} {item.due_date}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={received >= required ? 'green' : 'yellow'}>
                      {formatMoney(money(received, 'UZS'))} / {formatMoney(money(required, 'UZS'))}
                    </Badge>
                    {canEdit && received < required ? (
                      <form action={recordDepositAction} className="flex items-center gap-1">
                        <input type="hidden" name="eventId" value={event.id} />
                        <input type="hidden" name="index" value={i} />
                        <Input name="amount" type="number" min="1" placeholder={t('amountSoum')} required className="w-28 text-xs" />
                        <Button type="submit" variant="outline" size="sm">
                          {t('recordDeposit')}
                        </Button>
                      </form>
                    ) : null}
                  </span>
                </li>
              );
            })}
            {schedule.length === 0 ? <p className="text-gray-500">—</p> : null}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {event.status === 'DRAFT' && canEdit ? (
              <form action={eventTransitionAction}>
                <input type="hidden" name="id" value={event.id} />
                <input type="hidden" name="trigger" value="quote" />
                <Button type="submit">{t('quote')}</Button>
              </form>
            ) : null}
            {event.status === 'QUOTED' && canConfirm ? (
              <form action={eventTransitionAction} className="flex items-center gap-2">
                <input type="hidden" name="id" value={event.id} />
                <input type="hidden" name="trigger" value="confirm" />
                {hasRole(ctx, 'OWNER') ? (
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input type="checkbox" name="ownerOverride" className="h-4 w-4 accent-volt-600" /> {t('ownerOverride')}
                  </label>
                ) : null}
                <Button type="submit">{t('confirm')}</Button>
              </form>
            ) : null}
            {['IN_PROGRESS', 'CONFIRMED'].includes(event.status) && canEdit ? (
              <form action={eventTransitionAction} className="flex items-center gap-1.5">
                <input type="hidden" name="id" value={event.id} />
                <input type="hidden" name="trigger" value="mark_held" />
                <Input name="guestsActual" type="number" min="1" placeholder={t('guestsActual')} required className="w-28" />
                <Button type="submit" variant="outline">
                  {t('markHeld')}
                </Button>
              </form>
            ) : null}
            {event.status === 'SETTLING' && canClose ? (
              <form action={eventTransitionAction} className="flex items-center gap-1.5">
                <input type="hidden" name="id" value={event.id} />
                <input type="hidden" name="trigger" value="close" />
                {hasRole(ctx, 'OWNER') ? (
                  <Input name="reason" placeholder={t('closeReason')} className="w-52 text-xs" />
                ) : null}
                <Button type="submit" variant="dark">
                  {t('close')}
                </Button>
              </form>
            ) : null}
            {['DRAFT', 'QUOTED', 'CONFIRMED'].includes(event.status) && canEdit ? (
              <form action={eventTransitionAction}>
                <input type="hidden" name="id" value={event.id} />
                <input type="hidden" name="trigger" value="cancel" />
                <Button type="submit" variant="ghost">
                  {t('cancel')}
                </Button>
              </form>
            ) : null}
          </div>
        </Card>
      </div>

      {/* Linked objects */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={t('linkedPayments')}>
          <ul className="space-y-1.5 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold">{p.number}</span>
                <span className="flex items-center gap-2">
                  <span className="money">{formatMoney(money(p.requestedMinor, p.currency))}</span>
                  <Badge tone={['PAID', 'RECONCILED', 'CLOSED'].includes(p.status) ? 'green' : 'gray'}>{p.status}</Badge>
                </span>
              </li>
            ))}
            {payments.length === 0 ? <p className="text-gray-500">—</p> : null}
          </ul>
        </Card>
        <Card title={t('linkedInvoices')}>
          <ul className="space-y-1.5 text-sm">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-semibold">{inv.number}</span>
                <span className="flex items-center gap-2">
                  <span className="money">{formatMoney(money(inv.amountGrossMinor, inv.currency))}</span>
                  <Badge tone={inv.status === 'PAID' ? 'green' : inv.status === 'OVERDUE' ? 'red' : 'blue'}>{inv.status}</Badge>
                </span>
              </li>
            ))}
            {invoices.length === 0 ? <p className="text-gray-500">—</p> : null}
          </ul>
        </Card>
        <Card title={t('openTasks')}>
          <ul className="space-y-1.5 text-sm">
            {openTasks.map((task) => (
              <li key={task.id}>{task.nextAction}</li>
            ))}
            {openTasks.length === 0 ? <p className="text-gray-500">—</p> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}
