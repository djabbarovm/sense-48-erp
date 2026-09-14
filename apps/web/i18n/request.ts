import { cookies } from 'next/headers';
import type { AbstractIntlMessages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import ru from '../messages/ru.json';

export const SUPPORTED_LOCALES = ['ru', 'uz', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

// D-07: ru — полный словарь, uz/en — частичные с fallback на ru
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get('fos_locale')?.value;
  const locale: Locale = SUPPORTED_LOCALES.includes(cookieLocale as Locale)
    ? (cookieLocale as Locale)
    : 'ru';
  let messages: Record<string, unknown> = ru;
  if (locale !== 'ru') {
    try {
      const overrides = (await import(`../messages/${locale}.json`)).default;
      messages = deepMerge(ru, overrides);
    } catch {
      messages = ru;
    }
  }
  return { locale, messages: messages as AbstractIntlMessages };
});

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object'
        ? deepMerge(base[k] as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}
