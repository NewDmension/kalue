// File: src/app/data-deletion/page.tsx
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Data Deletion | Kalue',
  description: 'How to request deletion of your data in Kalue.',
  robots: { index: true, follow: true },
};

export const dynamic = 'force-dynamic';

export default function DataDeletionPage() {
  const lastUpdated = new Date().toLocaleDateString('en-GB');

  return (
    <main className="min-h-screen w-full text-white">
      {/* Background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-[#0b1020] via-[#070a14] to-black" />
        <div className="absolute -top-32 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute -bottom-40 left-10 h-[420px] w-[420px] rounded-full bg-violet-500/15 blur-3xl" />
      </div>

      <header className="mx-auto w-full max-w-6xl px-4 pt-6">
        <div className="card-glass flex items-center justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            <div className="relative h-9 w-9 overflow-hidden rounded-xl border border-white/10 bg-white/5">
              <Image src="/logo.png" alt="Kalue" fill className="object-contain p-1.5" priority />
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-white">Kalue</p>
              <p className="text-xs text-white/60">Data Deletion</p>
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
              href="/login"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
            >
              Login
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl px-4 pb-16 pt-10">
        <div className="card-glass rounded-2xl border border-white/10 p-6">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Data Deletion</h1>
          <p className="mt-2 text-xs text-white/55">Last updated: {lastUpdated}</p>

          <div className="mt-6 grid gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm font-semibold text-white/90">How to request deletion</p>
              <p className="mt-2 text-sm leading-relaxed text-white/70">
                To request deletion of your Kalue account and associated data, email us from the address linked to your Kalue account at:{' '}
                <a className="text-indigo-200 hover:underline" href="mailto:privacy@kalue.app">privacy@kalue.app</a>.
              </p>

              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-white/70">
                <li>Subject: <span className="font-mono text-white/85">Data Deletion Request</span></li>
                <li>Include: your account email, workspace name (if known), and confirmation you want the account deleted.</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm font-semibold text-white/90">What we delete</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/70">
                <li>Account identity in Kalue (subject to verification).</li>
                <li>Workspace membership data related to your account.</li>
                <li>Lead data stored in your workspace (as applicable to your request and workspace ownership rules).</li>
                <li>Integration tokens for your workspace (stored encrypted).</li>
              </ul>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm font-semibold text-white/90">Timeline</p>
              <p className="mt-2 text-sm leading-relaxed text-white/70">
                We typically process deletion requests within a reasonable timeframe. Some data may be retained if required by law or for
                legitimate security purposes (e.g., audit logs), but we minimize retained data.
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-5">
              <p className="text-sm font-semibold text-emerald-200">For Meta App Review</p>
              <p className="mt-2 text-sm leading-relaxed text-emerald-100/80">
                This page is publicly accessible without login and describes how users can request deletion of their data, per platform
                requirements.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-white/60">
              Back to{' '}
              <Link href="/" className="text-indigo-200 hover:underline">
                Home
              </Link>
            </p>
            <p className="text-xs text-white/45">
              Contact:{' '}
              <a className="text-indigo-200 hover:underline" href="mailto:privacy@kalue.app">
                privacy@kalue.app
              </a>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
