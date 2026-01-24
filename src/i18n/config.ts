export type AppLocale = 'es' | 'en';

export const LOCALES: readonly AppLocale[] = ['es', 'en'] as const;

export const DEFAULT_LOCALE: AppLocale = 'es';

export function isAppLocale(v: string | null | undefined): v is AppLocale {
  return v === 'es' || v === 'en';
}
