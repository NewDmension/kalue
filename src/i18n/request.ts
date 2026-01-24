// File: src/i18n/request.ts
import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from './config';

function pickLocaleFromAcceptLanguage(al: string): AppLocale {
  const lower = al.toLowerCase();
  if (lower.includes('en')) return 'en';
  return 'es';
}

export default getRequestConfig(async () => {
  // ✅ Next 16: cookies() y headers() son async en types
  const cookieStore = await cookies();
  const headerStore = await headers();

  const rawCookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
  const localeFromCookie: AppLocale | null = isAppLocale(rawCookieLocale) ? rawCookieLocale : null;

  const al = headerStore.get('accept-language') ?? '';
  const localeFromHeader: AppLocale = pickLocaleFromAcceptLanguage(al);

  const locale: AppLocale = localeFromCookie ?? localeFromHeader ?? DEFAULT_LOCALE;

  const messages = (await import(`../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
  };
});
