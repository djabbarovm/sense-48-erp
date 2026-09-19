import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockNotificationAdapter } from '@finance-os/adapters';
import { prisma } from '@finance-os/db';
import { buildJobs, runTenantJobs } from '../src/jobs.js';

let tenantId: string;

describe('D-05 workers: реестр джобов', () => {
  beforeAll(async () => {
    tenantId = (
      await prisma.tenant.create({
        data: { slug: `t-d05-${Date.now()}`, legalName: 'D05', taxId: '300000077' },
      })
    ).id;
  });
  afterAll(async () => prisma.$disconnect());

  it('все джобы объявлены c cron и идемпотентно прогоняются на пустом tenant', async () => {
    const names = buildJobs().map((j) => j.name);
    expect(names).toEqual([
      'task-escalation',
      'advance-overdue',
      'ar-overdue',
      'ar-reminders',
      'contract-expiry',
      'lease-expiry',
      'deal-followup',
      'workorder-sla',
      'service-sla',
      'rent-charges',
      'rent-overdue',
      'domain-events',
      'event-progress',
      'batch-cutoff-freeze',
      'forecast-snapshot',
      'tax-generate',
      'tax-overdue',
      'kpi-snapshot',
      'audit-verify',
    ]);
    const notifier = new MockNotificationAdapter();
    const first = await runTenantJobs(tenantId, { notifier });
    const errors = Object.entries(first).filter(([, v]) => typeof v === 'string');
    expect(errors).toEqual([]); // ни один джоб не упал
    const second = await runTenantJobs(tenantId, { notifier });
    expect(Object.values(second).some((v) => typeof v === 'string')).toBe(false);
  });

  it('ar-reminders шлёт уведомление AR-owner через NotificationAdapter (BR-060, без сумм)', async () => {
    const owner = await prisma.user.create({ data: { email: `d05-${Date.now()}@t.test`, fullName: 'AR' } });
    const customer = await prisma.customer.create({
      data: { tenantId, legalName: 'C', paymentTermsDays: 0, arOwnerId: owner.id },
    });
    await prisma.customerInvoice.create({
      data: {
        tenantId,
        number: 'CINV-D05-1',
        customerId: customer.id,
        date: new Date('2026-09-01'),
        dueDate: new Date('2026-09-10'),
        amountGrossMinor: 5_000_000_00n,
        status: 'ISSUED',
      },
    });
    const notifier = new MockNotificationAdapter();
    await runTenantJobs(tenantId, { notifier, now: new Date('2026-09-14') });
    const arNotes = notifier.sent.filter((s) => s.template === 'AR_REMINDER');
    expect(arNotes.length).toBeGreaterThanOrEqual(1);
    expect(arNotes[0]!.userId).toBe(owner.id);
    // BR-072: в тексте нет суммы
    expect(arNotes[0]!.text).not.toMatch(/5[\s ]?000[\s ]?000/);
  });
});
