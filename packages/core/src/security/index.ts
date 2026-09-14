/**
 * BR-072: regex-фильтр на OTP-подобные строки в свободном тексте
 * (comment/purpose): слова otp/код/пароль + 4–8 цифр рядом → отказ сохранения.
 */
import { ValidationError } from '../errors/index.js';

const TRIGGER_WORDS = /(otp|од?норазовый|код|пароль|password|пин|pin)/i;
const DIGITS = /\b\d{4,8}\b/;

export function looksLikeSecret(text: string): boolean {
  return TRIGGER_WORDS.test(text) && DIGITS.test(text);
}

/** Бросает ValidationError c подсказкой, если текст похож на OTP/пароль (BR-072). */
export function assertNoSecrets(text: string | null | undefined, field = 'text'): void {
  if (!text) return;
  if (looksLikeSecret(text)) {
    throw new ValidationError(
      'SECRET_SUSPECTED',
      `Поле «${field}» похоже на OTP/код/пароль (BR-072). Уберите цифровой код из текста — секреты не хранятся ни в БД, ни в логах.`,
    );
  }
}

export * from './rateLimit.js';
