/**
 * D-05: реестр repeatable-джобов. Каждый джоб — чистая идемпотентная функция
 * (tenantId, now) → count; вся логика живёт в @finance-os/db-сервисах и покрыта
 * их тестами. BullMQ-обвязка — в queue.ts; без Redis джобы можно гонять напрямую
 * (runTenantJobs) — так работают тесты и dev без docker.
 */
import type { NotificationAdapter, TelegramBotApi } from '@finance-os/adapters';
import {
  autoFreezeBatches,
  createDealFollowupTasks,
  createExpiryTasksForTenant,
  deliverDomainEvents,
  markOverdueOwnerFollowups,
  sendCrmDigests,
  sendCrmReminders,
  escalateOverdueWorkOrders,
  escalateOverdueServiceOrders,
  generateRentCharges,
  markOverdueRentCharges,
  withholdExpiredKpi,
  runServicePackages,
  generateHouseCharges,
  markOverdueHouseCharges,
  markExpiringLeases,
  escalateOverdueTasks,
  generateTaxObligations,
  markOverdueAdvances,
  markOverdueCustomerInvoices,
  markOverdueTaxObligations,
  prisma,
  progressEvents,
  runArReminders,
  snapshotForecast,
  snapshotKpis,
  verifyAuditChain,
} from '@finance-os/db';

export interface JobDef {
  name: string;
  /** cron по умолчанию (D-05); переопределяется в env/queue */
  cron: string;
  run(tenantId: string, now?: Date): Promise<number>;
}

export function buildJobs(notifier?: NotificationAdapter, bot?: TelegramBotApi): JobDef[] {
  return [
    {
      name: 'task-escalation',
      cron: '*/15 * * * *',
      run: (tenantId, now) => escalateOverdueTasks(tenantId, now),
    },
    {
      name: 'advance-overdue',
      cron: '0 6 * * *',
      run: (tenantId, now) => markOverdueAdvances(tenantId, now),
    },
    {
      name: 'ar-overdue',
      cron: '0 6 * * *',
      run: (tenantId, now) => markOverdueCustomerInvoices(tenantId, now),
    },
    {
      name: 'ar-reminders',
      cron: '0 7 * * *',
      run: async (tenantId, now) => {
        const sent = await runArReminders(tenantId, now);
        if (notifier) {
          for (const reminder of sent) {
            if (!reminder.arOwnerId) continue;
            await notifier.send({
              userId: reminder.arOwnerId,
              template: 'AR_REMINDER',
              params: { invoice_number: reminder.number, offset: `T${reminder.offsetDays >= 0 ? '+' : ''}${reminder.offsetDays}` },
              deepLink: `/ar`,
            });
          }
        }
        return sent.length;
      },
    },
    {
      name: 'contract-expiry',
      cron: '0 5 * * *',
      run: (tenantId, now) => createExpiryTasksForTenant(tenantId, now),
    },
    // MDS Property Wave 2 (docs/20 §11)
    {
      name: 'lease-expiry',
      cron: '15 5 * * *',
      run: (tenantId, now) => markExpiringLeases(tenantId, now),
    },
    {
      name: 'deal-followup',
      cron: '0 8 * * *',
      run: (tenantId, now) => createDealFollowupTasks(tenantId, now),
    },
    {
      name: 'workorder-sla',
      cron: '*/30 * * * *',
      run: (tenantId, now) => escalateOverdueWorkOrders(tenantId, now),
    },
    {
      name: 'service-sla',
      cron: '*/30 * * * *',
      run: (tenantId, now) => escalateOverdueServiceOrders(tenantId, now),
    },
    {
      name: 'rent-charges',
      cron: '30 3 * * *',
      run: (tenantId, now) => generateRentCharges(tenantId, now),
    },
    {
      name: 'rent-overdue',
      cron: '45 3 * * *',
      run: (tenantId, now) => markOverdueRentCharges(tenantId, now),
    },
    {
      name: 'bonus-kpi-deadline',
      cron: '0 4 * * *',
      run: (tenantId, now) => withholdExpiredKpi(tenantId, now),
    },
    {
      name: 'service-packages',
      cron: '15 6 * * *',
      run: (tenantId, now) => runServicePackages(tenantId, now),
    },
    {
      name: 'house-charges',
      cron: '0 3 1 * *',
      run: async (tenantId, now) => (await generateHouseCharges(tenantId, now)).created,
    },
    {
      name: 'crm-reminders',
      cron: '*/15 * * * *',
      run: (tenantId, now) => (bot ? sendCrmReminders(tenantId, now ?? new Date(), bot) : Promise.resolve(0)),
    },
    {
      name: 'crm-digest-morning',
      cron: '30 3 * * *',
      run: (tenantId, now) => (bot ? sendCrmDigests(tenantId, now ?? new Date(), bot, 'morning') : Promise.resolve(0)),
    },
    {
      name: 'crm-digest-evening',
      cron: '0 14 * * *',
      run: (tenantId, now) => (bot ? sendCrmDigests(tenantId, now ?? new Date(), bot, 'evening') : Promise.resolve(0)),
    },
    {
      name: 'owner-followup',
      cron: '0 5 * * *',
      run: (tenantId, now) => markOverdueOwnerFollowups(tenantId, now),
    },
    {
      name: 'house-overdue',
      cron: '30 4 * * *',
      run: (tenantId, now) => markOverdueHouseCharges(tenantId, now),
    },
    {
      name: 'domain-events',
      cron: '*/5 * * * *',
      run: (tenantId, now) => deliverDomainEvents(tenantId, now, notifier),
    },
    {
      name: 'event-progress',
      cron: '0 4 * * *',
      run: (tenantId, now) => progressEvents(tenantId, now),
    },
    {
      name: 'batch-cutoff-freeze',
      cron: '*/10 * * * *',
      run: (tenantId, now) => autoFreezeBatches(tenantId, now),
    },
    {
      name: 'forecast-snapshot',
      cron: '0 3 * * 1',
      run: async (tenantId, now) => {
        await snapshotForecast(tenantId, now);
        return 1;
      },
    },
    {
      name: 'tax-generate',
      cron: '0 5 1 * *',
      run: (tenantId, now) => generateTaxObligations(tenantId, now),
    },
    {
      name: 'tax-overdue',
      cron: '0 6 * * *',
      run: (tenantId, now) => markOverdueTaxObligations(tenantId, now),
    },
    {
      name: 'kpi-snapshot',
      cron: '30 2 * * *',
      run: async (tenantId, now) => {
        await snapshotKpis(tenantId, now);
        return 1;
      },
    },
    {
      name: 'audit-verify',
      cron: '0 2 * * *',
      run: async (tenantId) => {
        const result = await verifyAuditChain(tenantId);
        if (!result.valid) {
          // нарушение цепочки — критично: security alert всем Owner'ам tenant'а
          const owners = await prisma.userTenantRole.findMany({ where: { tenantId, role: 'OWNER' } });
          for (const owner of owners) {
            await notifier?.send({
              userId: owner.userId,
              template: 'SECURITY_ALERT',
              params: { vendor_display_name: `AUDIT CHAIN BROKEN: ${result.reason ?? ''}` },
              deepLink: '/admin',
            });
          }
          throw new Error(`AUDIT_CHAIN_BROKEN: tenant=${tenantId} ${result.reason ?? ''}`);
        }
        return 1;
      },
    },
  ];
}

/** Прогон всех джобов для tenant'а (dev/tests/CLI без Redis). */
export async function runTenantJobs(
  tenantId: string,
  opts: { notifier?: NotificationAdapter; now?: Date } = {},
): Promise<Record<string, number | string>> {
  const results: Record<string, number | string> = {};
  for (const job of buildJobs(opts.notifier)) {
    try {
      results[job.name] = await job.run(tenantId, opts.now);
    } catch (error) {
      results[job.name] = `ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return results;
}
