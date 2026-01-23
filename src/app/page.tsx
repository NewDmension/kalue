'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Mode = 'signin' | 'signup';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const title = useMemo(() => (mode === 'signin' ? 'Entrar' : 'Crear cuenta'), [mode]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg('Cuenta creada. Revisa tu email si Supabase requiere confirmación.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setMsg('Login OK.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error inesperado';
      setMsg(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[520px] card-glass p-6">
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
            required
          />
        </div>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Procesando…' : title}
        </button>
      </form>

      {msg ? <p className="mt-4 text-sm text-white/70">{msg}</p> : null}
    </div>
  );
}
