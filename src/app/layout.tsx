// src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { NextIntlClientProvider } from 'next-intl';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from '@/i18n/config';
import { loadMessages } from '@/i18n/request';

export const metadata: Metadata = {
  title: 'Kalue',
  description: 'Lead operations system',
};

function pickLocaleFromCookie(raw: string | undefined | null): AppLocale {
  return isAppLocale(raw) ? raw : DEFAULT_LOCALE;
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const raw = cookieStore.get('NEXT_LOCALE')?.value ?? null;
  const locale = pickLocaleFromCookie(raw);

  const messages = await loadMessages(locale);

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <div className="min-h-screen">
            <div className="container-default py-8">{props.children}</div>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
