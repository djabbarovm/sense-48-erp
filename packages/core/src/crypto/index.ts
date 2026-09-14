/**
 * Шифрование банковских реквизитов (docs/11): AES-256-GCM, ключ BANK_DATA_KEY
 * (32 байта base64) из env. Формат: v1$<iv b64>$<tag b64>$<ciphertext b64>.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ValidationError } from '../errors/index.js';

function loadKey(rawKey: string): Buffer {
  const key = Buffer.from(rawKey, 'base64');
  if (key.length !== 32) throw new ValidationError('BANK_DATA_KEY_INVALID', 'BANK_DATA_KEY must be 32 bytes base64');
  return key;
}

export function encryptSecret(plaintext: string, rawKey: string): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1$${iv.toString('base64')}$${tag.toString('base64')}$${ciphertext.toString('base64')}`;
}

export function decryptSecret(stored: string, rawKey: string): string {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new ValidationError('CIPHERTEXT_INVALID');
  const key = loadKey(rawKey);
  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const ciphertext = Buffer.from(parts[3]!, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Маскирование счёта: только последние 4 цифры (docs/11, BR-074). */
export function maskAccount(account: string): string {
  const digits = account.replace(/\D/g, '');
  return `****${digits.slice(-4)}`;
}

/** Валидация счёта РУз: 20 цифр. */
export function assertValidAccountNumber(account: string): void {
  if (!/^\d{20}$/.test(account.replace(/\s/g, ''))) {
    throw new ValidationError('ACCOUNT_NUMBER_INVALID', 'Bank account must be 20 digits');
  }
}
