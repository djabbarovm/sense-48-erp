import { NOTIFICATION_TEXTS, type NotificationAdapter, type NotificationInput } from './types.js';

/**
 * Telegram Bot API адаптер (HTTP). Токен — только из env, никогда не логируется
 * (BR-072). chat_id пользователя резолвится колбэком (User.telegramChatId в БД,
 * линкуется командой /start <code> — bot-процесс в prod-развёртывании).
 * В dev/tests используйте MockNotificationAdapter.
 */
export class TelegramNotificationAdapter implements NotificationAdapter {
  constructor(
    private readonly botToken: string,
    private readonly resolveChatId: (userId: string) => Promise<string | null>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(input: NotificationInput): Promise<void> {
    const chatId = await this.resolveChatId(input.userId);
    if (!chatId) return; // пользователь не слинковал чат — молча пропускаем (email fallback выше)
    const text = `${NOTIFICATION_TEXTS[input.template](input.params)}\n${input.deepLink}`;
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      // текст ошибки без токена (BR-072)
      throw new Error(`TELEGRAM_SEND_FAILED: HTTP ${res.status}`);
    }
  }
}

/**
 * Email fallback (docs/07 §6): транспорт инжектируется (nodemailer → MailHog в dev,
 * реальный SMTP в prod) — адаптер не тянет SMTP-зависимость в домен.
 */
export class EmailNotificationAdapter implements NotificationAdapter {
  constructor(
    private readonly resolveEmail: (userId: string) => Promise<string | null>,
    private readonly transport: (to: string, subject: string, text: string) => Promise<void>,
  ) {}

  async send(input: NotificationInput): Promise<void> {
    const email = await this.resolveEmail(input.userId);
    if (!email) return;
    const text = `${NOTIFICATION_TEXTS[input.template](input.params)}\n${input.deepLink}`;
    await this.transport(email, `Finance OS: ${input.template}`, text);
  }
}

/** Основной + fallback: если Telegram не доставил (нет chat_id/ошибка) — email. */
export class FallbackNotificationAdapter implements NotificationAdapter {
  constructor(
    private readonly primary: NotificationAdapter,
    private readonly fallback: NotificationAdapter,
  ) {}

  async send(input: NotificationInput): Promise<void> {
    try {
      await this.primary.send(input);
    } catch {
      await this.fallback.send(input);
    }
  }
}
