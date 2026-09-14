import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeCreateTenantContext } from '@finance-os/core';
import { prisma } from '../src/client.js';
import {
  createEvent,
  getEventPl,
  progressEvents,
  recordDeposit,
  transitionEvent,
  upsertEventBudgetLine,
} from '../src/services/events.js';
import { createCustomerInvoice, issueCustomerInvoice } from '../src/services/arInvoices.js';

let tenantId: string;
let customerId: string;
let categoryId: string;

const owner = () => unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['OWNER'] });
const lead = () => unsafeCreateTenantContext({ tenantId, tenantSlug: 'x', userId: crypto.randomUUID(), roles: ['FINANCE_OPS_LEAD'] });

const NOW = new Date('2026-09-14T12:00:00Z');

async function mkQuotedEvent(over: Partial<Parameters<typeof createEvent>[1]> = {}) {
  const event = await createEvent(lead(), {
    name: `Банкет ${Math.random().toString(36).slice(2, 6)}`,
    eventDate: new Date('2026-09-27'),
    customerId,
    revenueBudgetMinor: 10_000_000_00n,
    revenueLines: { venue_fee: '4000000.00', catering: '6000000.00' },
    depositSchedule: [{ pct: 30, due_date: '2026-09-17' }],
    ...over,
  });
  await transitionEvent(lead(), event.id, 'quote');
  await upsertEventBudgetLine(lead(), event.id, { categoryId, plannedMinor: 4_000_000_00n });
  return event;
}

describe('D-03 Event: state machine, BR-061/062, P&L', () => {
  beforeAll(async () => {
    const ts = Date.now();
    tenantId = (await prisma.tenant.create({ data: { slug: `t-d03-${ts}`, legalName: 'D03', taxId: '300000055' } })).id;
    customerId = (
      await prisma.customer.create({ data: { tenantId, legalName: 'ООО «Гости»', paymentTermsDays: 3 } })
    ).id;
    categoryId = (
      await prisma.category.create({ data: { tenantId, code: 'EVT_FNB', name: 'FNB', group: 'OTHER' } })
    ).id;
  });
  afterAll(async () => prisma.$disconnect());

  it('BR-062: confirm без депозита блокируется; Owner может override; c депозитом проходит', async () => {
    const event = await mkQuotedEvent();
    await expect(transitionEvent(lead(), event.id, 'confirm')).rejects.toThrow(/DEPOSIT_REQUIRED|депозит/i);
    // депозит 30% от 10 млн = 3 млн
    await recordDeposit(lead(), event.id, 0, 3_000_000_00n);
    const confirmed = await transitionEvent(lead(), event.id, 'confirm');
    expect(confirmed.status).toBe('CONFIRMED');
    // второй ивент: Owner подтверждает без депозита c override
    const event2 = await mkQuotedEvent();
    const viaOwner = await transitionEvent(owner(), event2.id, 'confirm', { ownerOverride: true });
    expect(viaOwner.status).toBe('CONFIRMED');
  });

  it('авто-прогресс: CONFIRMED (дата наступила) → IN_PROGRESS; HELD → SETTLING; guests обязательны', async () => {
    const event = await mkQuotedEvent({ eventDate: new Date('2026-09-10') });
    await recordDeposit(lead(), event.id, 0, 3_000_000_00n);
    await transitionEvent(lead(), event.id, 'confirm');
    const moved = await progressEvents(tenantId, NOW);
    expect(moved).toBeGreaterThanOrEqual(1);
    const inProgress = await prisma.event.findUnique({ where: { id: event.id } });
    expect(inProgress!.status).toBe('IN_PROGRESS');
    await expect(transitionEvent(lead(), event.id, 'mark_held')).rejects.toThrow(/гостей/);
    await transitionEvent(lead(), event.id, 'mark_held', { guestsActual: 120 });
    await progressEvents(tenantId, NOW);
    expect((await prisma.event.findUnique({ where: { id: event.id } }))!.status).toBe('SETTLING');
  });

  it('BR-061: close блокируется открытыми платежами/AR; Owner c reason может; P&L считает committed/actual/margin', async () => {
    const event = await mkQuotedEvent({ eventDate: new Date('2026-09-01') });
    await recordDeposit(lead(), event.id, 0, 3_000_000_00n);
    await transitionEvent(lead(), event.id, 'confirm');
    await progressEvents(tenantId, NOW);
    await transitionEvent(lead(), event.id, 'mark_held', { guestsActual: 80 });
    await progressEvents(tenantId, NOW);

    // AR-счёт по событию (не оплачен) + pending платёж
    const cinv = await createCustomerInvoice(lead(), {
      customerId,
      date: NOW,
      amountGrossMinor: 10_000_000_00n,
      eventId: event.id,
    });
    await issueCustomerInvoice(lead(), cinv.id);
    const contract = await prisma.contract.create({
      data: {
        tenantId,
        number: `CTR-D03-${Date.now()}`,
        counterpartyType: 'CUSTOMER',
        customerId,
        subject: 'x',
        startDate: NOW,
        status: 'ACTIVE',
      },
    });
    await prisma.paymentRequest.create({
      data: {
        tenantId,
        number: `PAY-D03-${Date.now()}`,
        sourceType: 'CONTRACT',
        sourceId: contract.id,
        requestedMinor: 2_500_000_00n,
        purposeNote: 'декор',
        eventId: event.id,
        categoryId,
        status: 'READY_FOR_BATCH',
      },
    });

    const pl = await getEventPl(lead(), event.id);
    expect(pl.revenueInvoicedMinor).toBe(10_000_000_00n);
    expect(pl.depositsReceivedMinor).toBe(3_000_000_00n);
    expect(pl.arOutstandingMinor).toBe(10_000_000_00n);
    expect(pl.committedMinor).toBe(2_500_000_00n);
    expect(pl.marginCurrentMinor).toBe(7_500_000_00n);

    await expect(transitionEvent(lead(), event.id, 'close')).rejects.toThrow(/BR-061/);
    const closed = await transitionEvent(owner(), event.id, 'close', {
      closeOverrideReason: 'Остатки согласованы с клиентом, закрываем период',
    });
    expect(closed.status).toBe('CLOSED');
  });

  it('cancel c полученным депозитом создаёт refund task', async () => {
    const event = await mkQuotedEvent();
    await recordDeposit(lead(), event.id, 0, 1_000_000_00n);
    await transitionEvent(lead(), event.id, 'cancel');
    const task = await prisma.task.findFirst({ where: { tenantId, objectType: 'event', objectId: event.id } });
    expect(task?.nextAction).toMatch(/возврат/);
  });
});
