'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Mode = 'signin' | 'signup';

export default function RootAuthClient() {
  const searchParams = useSearchParams();
  const nextRaw = searchParams.get('next');
  const next = nextRaw && nextRaw.startsWith('/') ? nextRaw : '/app';

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const title = useMemo(() => (mode === 'signin' ? 'Entrar' : 'Crear cuenta'), [mode]);
  const subtitle = useMemo(
    () =>
      mode === 'signin'
        ? 'Accede a tu workspace de Kalue.'
        : 'Crea tu cuenta. Luego crearemos tu workspace.',
    [mode]
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    setMsg(null);

    try {
      const supabase = supabaseBrowser();

      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;

        // Si hay confirmación por email, no habrá sesión todavía
        if (!data.session) {
          setMsg('Cuenta creada. Revisa tu email para confirmar la cuenta.');
          return;
        }

        // Si hay sesión, hard redirect para que SSR lea cookies sb-*
        window.location.href = next;
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        if (error.message === 'Email not confirmed') {
          setMsg('Email no confirmado. Revisa tu bandeja y confirma la cuenta.');
        } else {
          setMsg(error.message);
        }
        return;
      }

      if (!data.session) {
        setMsg('Sesión no creada. Inténtalo de nuevo.');
        return;
      }

      // Importante: hard redirect para SSR/cookies
      window.location.href = next;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error inesperado';
      setMsg(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full max-w-[520px]">
      {/* LOGO */}
      <div className="mb-6 flex justify-center">
        <Image
          src="/brand/kalue-logo.png"
          alt="Kalue"
          width={240}
          height={96}
          priority
          className="h-12 w-auto"
        />
      </div>

      <div className="w-full card-glass rounded-2xl border border-white/10 p-6 sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-white">{title}</h1>
            <p className="mt-1 text-sm text-white/60">{subtitle}</p>
          </div>

          <button
            type="button"
            onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
            disabled={busy}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-60"
          >
            {mode === 'signin' ? 'Crear cuenta' : 'Entrar'}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <p className="mb-1 text-xs text-white/60">Email</p>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              autoComplete="email"
              placeholder="you@domain.com"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/90 placeholder:text-white/35 outline-none focus:border-indigo-400/50"
            />
          </div>

          <div>
            <p className="mb-1 text-xs text-white/60">Password</p>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/90 placeholder:text-white/35 outline-none focus:border-indigo-400/50"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2.5 text-sm text-indigo-200 hover:bg-indigo-500/15 disabled:opacity-60"
          >
            {busy ? 'Procesando…' : title}
          </button>

          {msg ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/75">
              {msg}
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
