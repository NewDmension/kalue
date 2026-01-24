// src/i18n/request.ts
import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from './config';

function normalizeLocale(raw: string | undefined | null): AppLocale {
  return isAppLocale(raw) ? raw : DEFAULT_LOCALE;
}

async function readLocaleFromCookie(): Promise<AppLocale | null> {
  try {
    const cookieStore = await cookies();
    const c = cookieStore.get('NEXT_LOCALE')?.value ?? null;
    if (!c) return null;
    return isAppLocale(c) ? c : null;
  } catch {
    return null;
  }
}

async function readLocaleFromAcceptLanguage(): Promise<AppLocale> {
  try {
    const h = await headers();
    const al = h.get('accept-language') ?? '';
    const lower = al.toLowerCase();
    if (lower.includes('en')) return 'en';
    return DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export async function getRequestLocale(): Promise<AppLocale> {
  const fromCookie = await readLocaleFromCookie();
  if (fromCookie) return fromCookie;
  return readLocaleFromAcceptLanguage();
}

export async function loadMessages(locale: AppLocale): Promise<Record<string, unknown>> {
  const safe = normalizeLocale(locale);
  // OJO: tus messages están en /src/messages (no en /src/i18n/messages)
  const mod = (await import(`../messages/${safe}.json`)) as { default: Record<string, unknown> };
  return mod.default;
}
