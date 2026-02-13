// File: src/app/page.tsx
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Kalue | LeadHub CRM',
  description:
    'Kalue is a LeadHub CRM to connect Meta Lead Ads, receive leads in real time, and manage pipelines securely per workspace.',
  robots: { index: true, follow: true },
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default function HomePage() {
  return (
    <main className="min-h-screen w-full text-white">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0b1020] via-[#070a14] to-black" />
        <div className="absolute -top-32 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute -bottom-40 left-10 h-[420px] w-[420px] rounded-full bg-violet-500/15 blur-3xl" />
      </div>

      {/* Header */}
      <header className="mx-auto w-full max-w-6xl px-4 pt-6">
        <div className="card-glass flex items-center justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="relative h-9 w-9 overflow-hidden rounded-xl border border-white/10 bg-white/5">
              <Image src="/public/brand/kalue-logo.png" alt="Kalue" fill className="object-contain p-1.5" priority />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-white">Kalue</p>
              <p className="text-xs text-white/60">LeadHub CRM</p>
            </div>
          </Link>

          <nav className="flex flex-wrap items-center justify-end gap-2">
            <Link
              href="/privacy"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
            >
              Privacy
            </Link>
            <Link
              href="/data-deletion"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
            >
              Data Deletion
            </Link>

            <Link
              href="/signup"
              className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/15"
            >
              Crear cuenta
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 hover:bg-white/10"
            >
              Login
            </Link>
          </nav>
        </div>
      </header>

      {/* Content */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
          {/* Left: hero */}
          <div className="card-glass rounded-2xl border border-white/10 p-6 lg:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/75">
              SaaS • Multi-tenant • Secure • Meta Lead Ads
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Captura y gestiona leads de Meta con un CRM moderno.
            </h1>

            <p className="mt-3 text-sm leading-relaxed text-white/70">
              Kalue conecta cada workspace con la cuenta de Meta del cliente (OAuth), suscribe webhooks (leadgen) y trae los leads a tu
              pipeline con control de acceso por workspace.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="rounded-xl border border-indigo-400/30 bg-indigo-500/20 px-4 py-2 text-sm font-semibold text-indigo-100 hover:bg-indigo-500/25"
              >
                Crear cuenta
              </Link>

              <Link
                href="/login"
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/10"
              >
                Entrar
              </Link>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {[
                { title: 'Leads en tiempo real', body: 'Webhook leadgen para recibir leads automáticamente.' },
                { title: 'Pipelines + etiquetas', body: 'Organiza tu flujo de ventas y seguimiento.' },
                { title: 'Multi-usuario por workspace', body: 'Cada negocio aislado (multi-tenant).' },
                { title: 'Tokens cifrados', body: 'Almacenamiento seguro de credenciales OAuth.' },
              ].map((f) => (
                <div key={f.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-sm font-semibold text-white/90">{f.title}</p>
                  <p className="mt-1 text-xs text-white/65">{f.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: how it works */}
          <div className="card-glass rounded-2xl border border-white/10 p-6 lg:p-8">
            <p className="text-sm font-semibold text-white/90">Cómo funciona</p>

            <ol className="mt-4 space-y-3 text-sm text-white/75">
              {[
                {
                  n: '1',
                  title: 'Crear workspace',
                  body: 'Cada cliente (o negocio) vive dentro de su workspace con usuarios propios.',
                },
                {
                  n: '2',
                  title: 'Conectar Meta (OAuth)',
                  body: 'El usuario autoriza y Kalue guarda el token cifrado por workspace.',
                },
                {
                  n: '3',
                  title: 'Elegir Page + Forms',
                  body: 'Guardas el mapping y activas el webhook leadgen para recibir leads.',
                },
                {
                  n: '4',
                  title: 'Leads al CRM',
                  body: 'Los leads entran en tiempo real y se organizan por pipeline.',
                },
              ].map((s) => (
                <li key={s.n} className="flex gap-3">
                  <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-white/90">
                    {s.n}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-white/90">{s.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-white/65">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4">
              <p className="text-sm font-semibold text-emerald-200">Para App Review</p>
              <p className="mt-2 text-xs leading-relaxed text-emerald-100/80">
                Esta landing y las páginas <span className="font-mono">/privacy</span> y <span className="font-mono">/data-deletion</span>{' '}
                son públicas (sin login), como requiere Meta para revisión de permisos.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                href="/privacy"
                className={cx(
                  'rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10'
                )}
              >
                Ver Privacy
              </Link>
              <Link
                href="/data-deletion"
                className={cx(
                  'rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10'
                )}
              >
                Ver Data Deletion
              </Link>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-10 text-center text-xs text-white/45">
          © {new Date().getFullYear()} Kalue · <a className="hover:underline" href="mailto:privacy@kalue.app">privacy@kalue.app</a>
        </footer>
      </section>
    </main>
  );
}
