// src/i18n/request.ts
import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from './config';

type Messages = Record<string, unknown>;

const LOADERS: Record<AppLocale, () => Promise<{ default: Messages }>> = {
  es: () => import('../messages/es.json'),
  en: () => import('../messages/en.json'),
};

async function pickLocaleFromCookie(): Promise<AppLocale | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get('NEXT_LOCALE')?.value ?? null;
    return raw && isAppLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

async function pickLocaleFromAcceptLanguage(): Promise<AppLocale> {
  try {
    const h = await headers();
    const al = (h.get('accept-language') ?? '').toLowerCase();
    if (al.includes('en')) return 'en';
    return DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export default getRequestConfig(async () => {
  const locale = (await pickLocaleFromCookie()) ?? (await pickLocaleFromAcceptLanguage());

  try {
    const mod = await LOADERS[locale]();
    return { locale, messages: mod.default };
  } catch (err) {
    console.error('[i18n] Failed to load messages for locale:', locale, err);
    return { locale, messages: {} };
  }
});
