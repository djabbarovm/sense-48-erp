import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { can, formatMoney, money } from '@finance-os/core';
import { listEvents, prisma } from '@finance-os/db';
import { requireTenantContext } from '@/lib/session';
import { Badge, Button, Card, EmptyState, Input, Label, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { createEventAction } from './actions';

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

export default async function EventsPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, 'payment.view')) notFound();
  const t = await getTranslations('events');

  const [events, customers] = await Promise.all([
    listEvents(ctx),
    prisma.customer.findMany({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' }, orderBy: { legalName: 'asc' } }),
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.legalName]));
  const canCreate = can(ctx, 'event.create');

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} />

      {canCreate ? (
        <Card title={t('newEvent')}>
          <form action={createEventAction} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <Label htmlFor="ev-name">{t('name')}</Label>
              <Input id="ev-name" name="name" required />
            </div>
            <div>
              <Label htmlFor="ev-date">{t('date')}</Label>
              <Input id="ev-date" name="eventDate" type="date" required />
            </div>
            <div>
              <Label htmlFor="ev-customer">{t('customer')}</Label>
              <Select id="ev-customer" name="customerId">
                <option value="">—</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.legalName}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ev-revenue">{t('revenue')}</Label>
              <Input id="ev-revenue" name="revenue" type="number" min="0" required />
            </div>
            <div className="flex items-end gap-2">
              <div>
                <Label htmlFor="ev-dep">{t('depositPct')}</Label>
                <Input id="ev-dep" name="depositPct" type="number" min="0" max="100" defaultValue="30" className="w-20" />
              </div>
              <Button type="submit">{t('create')}</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Table>
        <thead>
          <tr>
            <Th>{t('numberCol')}</Th>
            <Th>{t('name')}</Th>
            <Th>{t('date')}</Th>
            <Th>{t('customer')}</Th>
            <Th className="text-right">{t('guests')}</Th>
            <Th className="text-right">{t('revenue')}</Th>
            <Th>{t('statusLabel')}</Th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <Td>
                <Link href={`/events/${event.id}`} className="font-medium text-brand-700 hover:underline">
                  {event.number}
                </Link>
              </Td>
              <Td className="max-w-52 truncate">{event.name}</Td>
              <Td>{event.eventDate.toISOString().slice(0, 10)}</Td>
              <Td className="max-w-44 truncate">{event.customerId ? (customerName.get(event.customerId) ?? '—') : '—'}</Td>
              <Td className="tnum text-right">{event.guestsActual ?? event.guestsPlanned ?? '—'}</Td>
              <Td className="money text-right">{formatMoney(money(event.revenueBudgetMinor, 'UZS'))}</Td>
              <Td>
                <Badge tone={TONE[event.status]}>{t(`status.${event.status}`)}</Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {events.length === 0 ? <EmptyState text={t('empty')} /> : null}
    </div>
  );
}
