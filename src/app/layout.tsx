import type { Metadata } from 'next';
import './globals.css';

import { NextIntlClientProvider } from 'next-intl';
import { cookies } from 'next/headers';

export const metadata: Metadata = {
  title: 'Kalue',
  description: 'Lead operations system',
};

function normalizeLocale(raw: string | undefined): 'es' | 'en' {
  return raw === 'en' ? 'en' : 'es';
}

async function loadMessages(locale: 'es' | 'en'): Promise<Record<string, unknown>> {
  try {
    const mod = await import(`@/messages/${locale}.json`);
    return (mod as { default: Record<string, unknown> }).default;
  } catch {
    const mod = await import(`@/messages/es.json`);
    return (mod as { default: Record<string, unknown> }).default;
  }
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const cookieStore = await cookies(); // 👈 IMPORTANTE en Next 16
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
  const locale = normalizeLocale(cookieLocale);

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
