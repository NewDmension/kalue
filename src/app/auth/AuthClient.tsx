'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Mode = 'signin' | 'signup';

type ApiOk = { ok: true; next: string };
type ApiErr = { ok: false; error: string };
type ApiResp = ApiOk | ApiErr;

function isApiResp(v: unknown): v is ApiResp {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.ok === 'boolean' && (r.ok ? typeof r.next === 'string' : typeof r.error === 'string');
}

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
  const subtitle = useMemo(
    () => (mode === 'signin' ? 'Accede a tu workspace de Kalue.' : 'Crea tu cuenta. Luego crearemos tu workspace.'),
    [mode]
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    setMsg(null);

    try {
      const endpoint = mode === 'signup' ? '/auth/signup' : '/auth/signin';

      const res = await fetch(`${endpoint}?next=${encodeURIComponent(next)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const data = (await res.json().catch(() => null)) as unknown;
      if (!isApiResp(data)) throw new Error('Respuesta inválida del servidor');
      if (!res.ok || !data.ok) throw new Error(data.ok ? 'Error de autenticación' : data.error);

      if (mode === 'signup') {
        setMsg('Cuenta creada. Revisa tu email para confirmar la cuenta.');
        // si ya hay sesión por cookies, al ir a /app entrará
        window.location.assign(data.next);
        return;
      }

      // signin OK (hard nav)
      window.location.assign(data.next);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error inesperado';
      setMsg(message);
    } finally {
      setBusy(false);
    }
  }

  return (
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
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/75">{msg}</div>
        ) : null}
      </form>
    </div>
  );
}
