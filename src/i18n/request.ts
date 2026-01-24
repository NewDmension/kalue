// src/i18n/request.ts
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from './config';

type Messages = Record<string, unknown>;

function normalizeLocale(raw: unknown): AppLocale {
  return isAppLocale(raw) ? raw : DEFAULT_LOCALE;
}

async function readLocaleFromCookie(): Promise<AppLocale | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get('NEXT_LOCALE')?.value ?? null;
    return raw && isAppLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

async function readLocaleFromAcceptLanguage(): Promise<AppLocale> {
  try {
    const h = await headers();
    const al = (h.get('accept-language') ?? '').toLowerCase();
    if (al.includes('en')) return 'en';
    return DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function getRequestLocale(): Promise<AppLocale> {
  return (await readLocaleFromCookie()) ?? (await readLocaleFromAcceptLanguage());
}

/**
 * Import estático (sin template string) -> evita crashes en build/prod.
 * Tus JSON están en /src/messages/*.json
 */
const LOADERS: Record<AppLocale, () => Promise<{ default: Messages }>> = {
  es: () => import('../messages/es.json'),
  en: () => import('../messages/en.json'),
};

export async function loadMessages(locale: AppLocale): Promise<Messages> {
  const safe = normalizeLocale(locale);

  try {
    const mod = await LOADERS[safe]();
    return mod.default;
  } catch (err) {
    // Esto SÍ aparece en Vercel logs y nos dice el motivo real
    console.error('[i18n] Failed to load messages for locale:', safe, err);
    return {};
  }
}
