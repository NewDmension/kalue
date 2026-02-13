// File: src/app/login/page.tsx
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import LoginClient from '../LoginClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Login | Kalue',
  description: 'Login to Kalue.',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
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
              <p className="text-xs text-white/60">Login</p>
            </div>
          </Link>

          <nav className="flex items-center gap-2">
            <Link
              href="/signup"
              className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/15"
            >
              Crear cuenta
            </Link>
            <Link
              href="/"
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
            >
              Volver
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-10">
        <div className="card-glass rounded-2xl border border-white/10 p-6">
          {/* Importante: envolvemos en text-white para no romper estilos internos del LoginClient */}
          <div className="text-white">
            <LoginClient />
          </div>

          <div className="mt-5 text-center text-xs text-white/50">
            ¿No tienes cuenta?{' '}
            <Link href="/signup" className="text-indigo-200 hover:underline">
              Crear cuenta
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
