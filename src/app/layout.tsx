// src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

export const metadata: Metadata = {
  title: 'Kalue',
  description: 'Lead operations system',
};

export default async function RootLayout(props: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* ✅ Full width global. Nada de container aquí */}
          <div className="min-h-screen w-full">{props.children}</div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
