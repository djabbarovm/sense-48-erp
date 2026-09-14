import { describe, expect, it } from 'vitest';
import { assertNoSecrets, looksLikeSecret } from './index.js';

describe('BR-072 secret filter', () => {
  it('otp/код/пароль + 4-8 цифр → отказ', () => {
    expect(() => assertNoSecrets('код подтверждения 123456', 'comment')).toThrow(/BR-072/);
    expect(() => assertNoSecrets('OTP: 4821')).toThrow(/BR-072/);
    expect(() => assertNoSecrets('пароль от банка 55667788')).toThrow(/BR-072/);
  });
  it('обычные тексты проходят', () => {
    expect(() => assertNoSecrets('Оплата по счёту 118 за август')).not.toThrow();
    expect(() => assertNoSecrets('Аренда зала, сентябрь')).not.toThrow();
    expect(looksLikeSecret('Пароль вышлем отдельным каналом')).toBe(false); // нет 4-8 цифр
    expect(() => assertNoSecrets(null)).not.toThrow();
  });
});
