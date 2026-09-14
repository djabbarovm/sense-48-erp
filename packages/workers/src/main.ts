/** Точка входа prod-воркера: `node --import tsx src/main.ts` (docker-compose). */
import { ConsoleNotificationAdapter } from '@finance-os/adapters';
import { scheduleAll, startWorker } from './queue.js';

const queue = await scheduleAll();
const worker = startWorker(new ConsoleNotificationAdapter());
console.log('[workers] scheduled repeatable jobs, worker started');

process.on('SIGTERM', async () => {
  await worker.close();
  await queue.close();
  process.exit(0);
});
