'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useTranslations } from 'next-intl';

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export default function OnboardingPage() {
  const t = useTranslations('onboarding');
  const router = useRouter();

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function createWorkspace() {
    if (busy) return;

    const trimmed = name.trim();
    if (!trimmed) {
      setMsg(t('form.errorNameRequired'));
      return;
    }

    setBusy(true);
    setMsg(null);

    const supabase = supabaseBrowser();

    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      if (!userData.user) {
        // Login es HOME (/)
        router.push(`/?next=${encodeURIComponent('/onboarding')}`);
        router.refresh();
        return;
      }

      const slug = slugify(trimmed) || `ws-${userData.user.id.slice(0, 8)}`;

      // 1) crear workspace
      const { data: ws, error: wsErr } = await supabase
        .from('workspaces')
        .insert([{ name: trimmed, slug, created_by: userData.user.id }])
        .select('id')
        .single();

      if (wsErr) throw wsErr;
      if (!ws?.id) throw new Error(t('form.errorCreateWorkspace'));

      // 2) crear membership owner
      const { error: mErr } = await supabase.from('workspace_members').insert([
        { workspace_id: ws.id, user_id: userData.user.id, role: 'owner' },
      ]);

      if (mErr) throw mErr;

      router.push('/inbox');
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      setMsg(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full px-6 py-10 text-white">
      <div className="w-full">
        <div className="grid w-full gap-6 lg:grid-cols-2">
          <div className="card-glass rounded-2xl border border-white/10 p-7">
            <h1 className="text-3xl font-semibold">{t('title')}</h1>
            <p className="mt-2 text-sm text-white/60">{t('subtitle')}</p>

            <div className="mt-6 grid gap-3 text-sm text-white/70">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="font-medium text-white/85">{t('left.whatTitle')}</p>
                <p className="mt-1 text-white/60">
                  {t('left.whatBodyPrefix')}{' '}
                  <span className="text-white/80">{t('left.whatRole')}</span>.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="font-medium text-white/85">{t('left.afterTitle')}</p>
                <p className="mt-1 text-white/60">{t('left.afterBody')}</p>
              </div>
            </div>
          </div>

          <div className="card-glass rounded-2xl border border-white/10 p-7">
            <p className="text-xs text-white/60">{t('form.label')}</p>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/90 outline-none focus:border-indigo-400/50"
              placeholder={t('form.placeholder')}
              autoComplete="organization"
            />

            {msg ? (
              <div className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {msg}
              </div>
            ) : null}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => router.push('/inbox')}
                disabled={busy}
                className="rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm text-white/80 hover:bg-white/10 disabled:opacity-60"
              >
                {t('form.skip')}
              </button>

              <button
                type="button"
                onClick={() => void createWorkspace()}
                disabled={busy}
                className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-5 py-2.5 text-sm text-indigo-200 hover:bg-indigo-500/15 disabled:opacity-60"
              >
                {busy ? t('form.creating') : t('form.create')}
              </button>
            </div>

            <p className="mt-4 text-xs text-white/45">{t('form.hint')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
