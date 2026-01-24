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
          <div className="min-h-screen">
            <div className="container-default py-8">{props.children}</div>
          </div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
