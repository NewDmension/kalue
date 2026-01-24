// src/i18n/config.ts
export const LOCALES = ['es', 'en'] as const;
export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'es';

export function isAppLocale(v: unknown): v is AppLocale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}
