import { NOTIFICATION_TEXTS, type NotificationAdapter, type NotificationInput } from './types.js';

/** Mock для dev/tests: копит отправленное в памяти (реальных API нет — CLAUDE.md). */
export class MockNotificationAdapter implements NotificationAdapter {
  readonly sent: (NotificationInput & { text: string })[] = [];

  async send(input: NotificationInput): Promise<void> {
    this.sent.push({ ...input, text: NOTIFICATION_TEXTS[input.template](input.params) });
  }
}

/** Console-адаптер для dev-сервера: видно в логах, секретов в тексте нет by design. */
export class ConsoleNotificationAdapter implements NotificationAdapter {
  async send(input: NotificationInput): Promise<void> {
    console.log(`[notify:${input.template}] → user ${input.userId}: ${NOTIFICATION_TEXTS[input.template](input.params)} ${input.deepLink}`);
  }
}
