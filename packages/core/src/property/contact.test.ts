import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import { maskEmail, maskPhone, matchContact, normalizeEmail, normalizePhone } from './contact.js';

describe('CRM контакты (BR-P55)', () => {
  it('телефон нормализуется: скобки/пробелы/дефисы, 9 цифр → +998', () => {
    expect(normalizePhone('+998 (90) 123-45-67')).toBe('+998901234567');
    expect(normalizePhone('90 123 45 67')).toBe('+998901234567');
    expect(normalizePhone('998901234567')).toBe('+998901234567');
    expect(normalizePhone('')).toBeNull();
    expect(() => normalizePhone('12')).toThrow(ValidationError);
  });
  it('email в нижний регистр, маски скрывают PII', () => {
    expect(normalizeEmail(' Ali@Mail.UZ ')).toBe('ali@mail.uz');
    expect(() => normalizeEmail('nope')).toThrow(ValidationError);
    expect(maskPhone('+998901234567')).toBe('+99890***4567');
    expect(maskEmail('ali@mail.uz')).toBe('a***@mail.uz');
  });
  it('сопоставление: телефон приоритетнее email', () => {
    const c = [{ id: 'a', phone: '+998901', phoneAlt: null, email: 'x@y.z' }, { id: 'b', phone: null, phoneAlt: '+998902', email: 'q@y.z' }];
    expect(matchContact(c, '+998902', 'x@y.z')?.id).toBe('b');
    expect(matchContact(c, null, 'x@y.z')?.id).toBe('a');
    expect(matchContact(c, '+1', 'none@y.z')).toBeNull();
  });
});
