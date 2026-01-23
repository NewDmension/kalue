'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const registered = sp.get('registered') === '1';

  const canSubmit = email.trim().length > 3 && password.length > 0 && !loading;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setMsg(error.message);
        return;
      }

      router.push('/app');
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-0px)] flex items-center justify-center px-4 py-10 text-white">
      <div className="w-full max-w-[520px] card-glass rounded-2xl border border-white/10 p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
          <p className="mt-1 text-sm text-white/60">Accede a tu workspace.</p>
        </div>

        {registered ? (
          <div className="mb-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            Cuenta creada. Si Supabase requiere confirmación de email, revisa tu bandeja.
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-white/60">Email</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 outline-none focus:border-indigo-400/50"
              placeholder="tu@email.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <p className="mb-1 text-xs text-white/60">Contraseña</p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 outline-none focus:border-indigo-400/50"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {msg ? (
            <div className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {msg}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className={cx(
              'w-full rounded-xl border px-4 py-2 text-sm transition',
              canSubmit
                ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/15'
                : 'border-white/10 bg-white/5 text-white/40 cursor-not-allowed'
            )}
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-white/70">
          ¿No tienes cuenta?{' '}
          <Link className="text-indigo-300 hover:text-indigo-200" href="/auth/register">
            Crear cuenta
          </Link>
        </div>
      </div>
    </div>
  );
}
