'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';

type FormState = {
  email: string;
  password: string;
  confirm: string;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default function RegisterPage() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [form, setForm] = useState<FormState>({ email: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const canSubmit =
    form.email.trim().length > 3 &&
    form.password.length >= 8 &&
    form.password === form.confirm &&
    loading === false;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (form.password !== form.confirm) {
      setMsg('Las contraseñas no coinciden.');
      return;
    }
    if (form.password.length < 8) {
      setMsg('La contraseña debe tener al menos 8 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
      });

      if (error) {
        setMsg(error.message);
        return;
      }

      // Si email confirmations está ON, quizá no haya sesión todavía.
      // Te mandamos a login para que puedas entrar tras confirmar (o si ya quedó logueado).
      router.push('/auth/login?registered=1');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-0px)] flex items-center justify-center px-4 py-10 text-white">
      <div className="w-full max-w-[520px] card-glass rounded-2xl border border-white/10 p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">Crear cuenta</h1>
          <p className="mt-1 text-sm text-white/60">
            Regístrate para acceder a tu workspace.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <p className="mb-1 text-xs text-white/60">Email</p>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
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
              value={form.password}
              onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 outline-none focus:border-indigo-400/50"
              placeholder="mínimo 8 caracteres"
              autoComplete="new-password"
              required
            />
          </div>

          <div>
            <p className="mb-1 text-xs text-white/60">Repetir contraseña</p>
            <input
              type="password"
              value={form.confirm}
              onChange={(e) => setForm((p) => ({ ...p, confirm: e.target.value }))}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/90 outline-none focus:border-indigo-400/50"
              placeholder="repite la contraseña"
              autoComplete="new-password"
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
            {loading ? 'Creando…' : 'Crear cuenta'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-white/70">
          ¿Ya tienes cuenta?{' '}
          <Link className="text-indigo-300 hover:text-indigo-200" href="/auth/login">
            Inicia sesión
          </Link>
        </div>
      </div>
    </div>
  );
}
