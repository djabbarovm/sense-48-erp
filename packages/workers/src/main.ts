/** Точка входа prod-воркера: `node --import tsx src/main.ts` (docker-compose). */
import { ConsoleNotificationAdapter, ConsoleTelegramBotApi, HttpTelegramBotApi } from '@finance-os/adapters';
import { scheduleAll, startWorker } from './queue.js';

const queue = await scheduleAll();
// P-24: CRM-бот — реальный Bot API при TELEGRAM_BOT_TOKEN, иначе консоль (dev)
const bot = process.env.TELEGRAM_BOT_TOKEN ? new HttpTelegramBotApi(process.env.TELEGRAM_BOT_TOKEN) : new ConsoleTelegramBotApi();
const worker = startWorker(new ConsoleNotificationAdapter(), bot);
console.log('[workers] scheduled repeatable jobs, worker started');

process.on('SIGTERM', async () => {
  await worker.close();
  await queue.close();
  process.exit(0);
});
