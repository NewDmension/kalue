import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kalue',
  description: 'Lead operations system',
};

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <div className="min-h-screen">
          <div className="container-default py-8">{props.children}</div>
        </div>
      </body>
    </html>
  );
}
