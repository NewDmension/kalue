'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from 'next/navigation';

function slugify(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // mínimo 3 chars
  return base.length >= 3 ? base : 'workspace';
}

export default function OnboardingPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const suggestedSlug = useMemo(() => slugify(name), [name]);

  async function createWorkspace() {
    if (busy) return;
    setBusy(true);
    setErr(null);

    const finalName = name.trim();
    const finalSlug = (slug.trim() || suggestedSlug).trim();

    if (!finalName) {
      setErr('Pon un nombre de empresa.');
      setBusy(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('create_workspace', {
        p_name: finalName,
        p_slug: finalSlug,
      });

      if (error) throw error;

      // data = uuid del workspace
      if (!data) throw new Error('No se pudo crear el workspace');

      router.push('/app/inbox');
      router.refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error creando workspace';
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[720px]">
      <div className="card-glass border border-white/10 rounded-2xl p-6 sm:p-7 text-white">
        <h1 className="text-2xl font-semibold">Crea tu workspace</h1>
        <p className="mt-2 text-sm text-white/70">
          Un workspace es tu espacio privado (empresa). Nada se mezcla entre usuarios.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-white/60">Nombre</p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New Dmension"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/90 placeholder:text-white/35 outline-none focus:border-indigo-400/50"
            />
          </div>

          <div>
            <p className="mb-1 text-xs text-white/60">Slug</p>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder={suggestedSlug}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/90 placeholder:text-white/35 outline-none focus:border-indigo-400/50"
            />
            <p className="mt-1 text-[11px] text-white/50">
              Si lo dejas vacío, usamos: <span className="text-white/75">{suggestedSlug}</span>
            </p>
          </div>
        </div>

        {err ? (
          <div className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {err}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-center">
          <button
            type="button"
            onClick={() => void createWorkspace()}
            disabled={busy}
            className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-6 py-2.5 text-sm text-indigo-200 hover:bg-indigo-500/15 disabled:opacity-60"
          >
            {busy ? 'Creando…' : 'Crear workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
