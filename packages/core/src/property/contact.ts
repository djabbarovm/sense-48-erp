/**
 * CRM Tower — контакты (docs/20 §11.14): один клиент — много сделок; телефон в каноническом виде;
 * собственник и клиент — одно лицо, если совпал телефон. PII (телефон/email) — только по deal.contact.view.
 */
import { ValidationError } from '../errors/index.js';

export const CONTACT_KINDS = ['PERSON', 'COMPANY'] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** BR-P55: канонический телефон — только цифры c «+»; 9 цифр без кода → Узбекистан (+998), «8…» из 10 не трогаем. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 9) d = `998${d}`;
  if (d.length < 7 || d.length > 15) throw new ValidationError('PHONE_INVALID', `PHONE_INVALID: ${raw}`);
  return `+${d}`;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = raw?.trim().toLowerCase() ?? '';
  if (!e) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ValidationError('EMAIL_INVALID');
  return e;
}

/** Маскирование PII для ролей без deal.contact.view: +99890***4567, a***@mail.uz. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.length > 7 ? `${phone.slice(0, 6)}***${phone.slice(-4)}` : '***';
}
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [u = '', d = ''] = email.split('@');
  return `${u.slice(0, 1)}***@${d}`;
}

export interface ContactMatchCandidate { id: string; phone: string | null; phoneAlt: string | null; email: string | null }
/** Приоритет сопоставления: телефон → доп. телефон → email. */
export function matchContact<T extends ContactMatchCandidate>(cands: T[], phone: string | null, email: string | null): T | null {
  if (phone) { const p = cands.find((c) => c.phone === phone || c.phoneAlt === phone); if (p) return p; }
  if (email) { const e = cands.find((c) => c.email === email); if (e) return e; }
  return null;
}
