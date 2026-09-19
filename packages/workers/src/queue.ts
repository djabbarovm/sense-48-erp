/**
 * D-05: BullMQ-обвязка. Каждый джоб — repeatable по cron из jobs.ts, payload —
 * tenantId. Требует REDIS_URL; без него используйте runTenantJobs напрямую
 * (dev/тесты) или `pnpm --filter @finance-os/workers start` после `make dev`.
 */
import { Queue, Worker } from 'bullmq';
import type { NotificationAdapter, TelegramBotApi } from '@finance-os/adapters';
import { prisma } from '@finance-os/db';
import { buildJobs } from './jobs.js';

const QUEUE_NAME = 'finance-os-jobs';

function connection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return { host: url.hostname, port: Number(url.port || 6379) };
}

/** Регистрирует repeatable-джобы для всех активных tenant'ов. Идемпотентно. */
export async function scheduleAll(): Promise<Queue> {
  const queue = new Queue(QUEUE_NAME, { connection: connection() });
  const tenants = await prisma.tenant.findMany({ where: { status: 'ACTIVE' } });
  for (const job of buildJobs()) {
    for (const tenant of tenants) {
      // BullMQ v6: repeatable через Job Scheduler (идемпотентный upsert по id)
      await queue.upsertJobScheduler(
        `${job.name}:${tenant.id}`,
        { pattern: job.cron },
        { name: job.name, data: { tenantId: tenant.id } },
      );
    }
  }
  return queue;
}

export function startWorker(notifier?: NotificationAdapter, bot?: TelegramBotApi): Worker {
  const jobs = new Map(buildJobs(notifier, bot).map((j) => [j.name, j]));
  return new Worker(
    QUEUE_NAME,
    async (job) => {
      const def = jobs.get(job.name);
      if (!def) throw new Error(`UNKNOWN_JOB: ${job.name}`);
      const count = await def.run((job.data as { tenantId: string }).tenantId);
      return { count };
    },
    { connection: connection(), concurrency: 4 },
  );
}
