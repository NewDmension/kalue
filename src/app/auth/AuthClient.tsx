'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

type Mode = 'signin' | 'signup';

export default function AuthClient() {
  const searchParams = useSearchParams();
  const nextRaw = searchParams.get('next');
  const next = nextRaw && nextRaw.startsWith('/') ? nextRaw : '/app';

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const title = useMemo(() => (mode === 'signin' ? 'Entrar' : 'Crear cuenta'), [mode]);

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

        if (!data.session) {
          setMsg('Cuenta creada. Revisa tu email para confirmar la cuenta.');
          return;
        }

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
      <div className="mb-6 flex justify-center">
        <Image
          src="/logo-kalue.png"
          alt="Kalue"
          width={220}
          height={80}
          priority
          className="h-12 w-auto"
        />
      </div>

      <div className="mx-auto card-glass p-6 rounded-2xl border border-white/10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-white">{title}</h1>

          <button
            type="button"
            onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
            className="btn-ghost"
            disabled={busy}
          >
            {mode === 'signin' ? 'Crear cuenta' : 'Entrar'}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <div>
            <p className="mb-1 text-xs text-white/60">Email</p>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 outline-none focus:border-indigo-400/50"
              placeholder="you@domain.com"
              type="email"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <p className="mb-1 text-xs text-white/60">Password</p>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 outline-none focus:border-indigo-400/50"
              placeholder="••••••••"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'Procesando…' : title}
          </button>
        </form>

        {msg ? <p className="mt-4 text-sm text-white/70">{msg}</p> : null}
      </div>
    </div>
  );
}
