/**
 * Telegram Bot API для CRM-бота (docs/21 §6): отправка сообщений c inline-кнопками, ответ на callback, webhook.
 * Токен только из env, в ошибках не светится (BR-072). В тестах — MockTelegramBotApi.
 */
export interface TgButton { text: string; data: string }
export interface TgSendOptions { keyboard?: TgButton[][]; markdown?: boolean }
export interface TelegramBotApi {
  sendMessage(chatId: string, text: string, opts?: TgSendOptions): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  setWebhook(url: string, secret: string): Promise<void>;
}
/** Минимальный тип Update (только то, что используем). */
export interface TgUpdate {
  update_id?: number;
  message?: { message_id: number; text?: string; chat: { id: number | string }; from?: { id: number; first_name?: string; username?: string }; forward_from?: { first_name?: string; last_name?: string }; forward_sender_name?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number | string } }; from: { id: number } };
}

export class HttpTelegramBotApi implements TelegramBotApi {
  constructor(private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}
  private async call(method: string, body: Record<string, unknown>): Promise<void> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`TELEGRAM_${method.toUpperCase()}_FAILED: HTTP ${res.status}`);
  }
  sendMessage(chatId: string, text: string, opts: TgSendOptions = {}): Promise<void> {
    return this.call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...(opts.markdown ? { parse_mode: 'Markdown' } : {}), ...(opts.keyboard ? { reply_markup: { inline_keyboard: opts.keyboard.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data.slice(0, 64) }))) } } : {}) });
  }
  answerCallback(callbackId: string, text?: string): Promise<void> { return this.call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) }); }
  setWebhook(url: string, secret: string): Promise<void> { return this.call('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'] }); }
}

export class MockTelegramBotApi implements TelegramBotApi {
  readonly sent: { chatId: string; text: string; keyboard?: TgButton[][] }[] = [];
  readonly callbacks: string[] = [];
  async sendMessage(chatId: string, text: string, opts: TgSendOptions = {}): Promise<void> { this.sent.push({ chatId, text, ...(opts.keyboard ? { keyboard: opts.keyboard } : {}) }); }
  async answerCallback(callbackId: string): Promise<void> { this.callbacks.push(callbackId); }
  async setWebhook(): Promise<void> {}
}

/** Dev: печатает в консоль вместо Telegram (секретов в тексте нет by design). */
export class ConsoleTelegramBotApi implements TelegramBotApi {
  async sendMessage(chatId: string, text: string, opts: TgSendOptions = {}): Promise<void> { console.log(`[tg → ${chatId}] ${text}${opts.keyboard ? ` [${opts.keyboard.flat().map((b) => b.text).join(' | ')}]` : ''}`); }
  async answerCallback(): Promise<void> {}
  async setWebhook(): Promise<void> {}
}
