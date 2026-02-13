// File: src/app/page.tsx
import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Kalue | LeadHub CRM',
  description:
    'Kalue is a SaaS LeadHub CRM to connect Meta Lead Ads, receive leads in real time, and manage pipelines securely per workspace.',
  robots: { index: true, follow: true },
};

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white text-black">
      {/* Top bar */}
      <header className="border-b border-slate-200">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl border border-slate-200 bg-slate-50" aria-hidden="true" />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900">Kalue</p>
              <p className="text-xs text-slate-600">LeadHub CRM</p>
            </div>
          </div>

          <nav className="flex items-center gap-2">
            <Link
              href="/privacy"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Privacy
            </Link>
            <Link
              href="/data-deletion"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Data Deletion
            </Link>

            <Link
              href="/signup"
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              Crear cuenta
            </Link>

            <Link
              href="/login"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Login
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-6xl px-5 py-14">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700">
              SaaS • Multi-tenant • Secure
            </p>

            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
              Captura y gestiona leads de Meta como hace un CRM moderno.
            </h1>

            <p className="mt-4 text-base leading-relaxed text-slate-700">
              Kalue conecta tu negocio con Meta Lead Ads, recibe leads en tiempo real (webhooks), y los organiza por pipeline
              y etiquetas dentro de tu workspace. Ideal para equipos y agencias.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="rounded-2xl border border-indigo-200 bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Crear cuenta
              </Link>

              <Link
                href="/login"
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Entrar
              </Link>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {[
                { title: 'Leads en tiempo real', body: 'Webhook leadgen para recibir leads automáticamente.' },
                { title: 'Pipelines', body: 'Organiza el equipo con etapas y estados.' },
                { title: 'Multi-usuario por workspace', body: 'Datos aislados por cliente/workspace.' },
                { title: 'Seguridad', body: 'Tokens OAuth cifrados y control de acceso.' },
              ].map((f) => (
                <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-sm font-semibold text-slate-900">{f.title}</p>
                  <p className="mt-1 text-sm text-slate-700">{f.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-sm font-semibold text-slate-900">Cómo funciona</p>

              <ol className="mt-4 space-y-3 text-sm text-slate-700">
                <li className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-900">
                    1
                  </span>
                  <div>
                    <p className="font-semibold text-slate-900">Conecta Meta (OAuth)</p>
                    <p className="mt-0.5 text-slate-700">Cada cliente conecta su propio Meta dentro de su workspace.</p>
                  </div>
                </li>

                <li className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-900">
                    2
                  </span>
                  <div>
                    <p className="font-semibold text-slate-900">Elige Page + Forms</p>
                    <p className="mt-0.5 text-slate-700">Guardas el mapping y suscribes el webhook leadgen.</p>
                  </div>
                </li>

                <li className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-900">
                    3
                  </span>
                  <div>
                    <p className="font-semibold text-slate-900">Recibes leads en tu CRM</p>
                    <p className="mt-0.5 text-slate-700">Kalue ingesta leads y los organiza por pipeline.</p>
                  </div>
                </li>
              </ol>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-900">Para revisión de plataforma</p>
                <p className="mt-1 text-xs text-slate-700">
                  Esta landing y las páginas de Privacy/Data Deletion son públicas (sin login), como requiere Meta para App Review.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-700">© {new Date().getFullYear()} Kalue.</p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link href="/privacy" className="text-slate-700 hover:underline">
              Privacy
            </Link>
            <Link href="/data-deletion" className="text-slate-700 hover:underline">
              Data Deletion
            </Link>
            <a href="mailto:privacy@kalue.app" className="text-slate-700 hover:underline">
              privacy@kalue.app
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
