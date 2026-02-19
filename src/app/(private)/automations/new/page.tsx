'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { supabase } from '@/lib/supabaseClient';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';

type CreateResponse =
  | { ok: true; workflowId: string }
  | { ok: false; error: string; detail?: string };

export default function NewAutomationPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async (): Promise<void> => {
      const ws = await getActiveWorkspaceId();
      if (!ws) {
        setError('missing_workspace');
        router.push('/automations');
        return;
      }

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setError('login_required');
        router.push('/automations');
        return;
      }

      const res = await fetch('/api/automations/workflows/create', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-workspace-id': ws,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Nuevo workflow' }),
      });

      const j = (await res.json()) as CreateResponse;
      if (!j.ok) {
        setError(j.detail ?? j.error);
        router.push('/automations');
        return;
      }

      router.push(`/automations/${j.workflowId}`);
    };

    void run();
  }, [router]);

  return (
    <div className="p-6">
      <div className="card-glass rounded-2xl border border-white/10 bg-black/20 p-6 backdrop-blur">
        {error ? (
          <div>
            <div className="text-white/90 font-medium">No se pudo crear el workflow</div>
            <div className="mt-2 text-sm text-white/70">{error}</div>
          </div>
        ) : (
          <div className="text-white/80">Creando workflow…</div>
        )}
      </div>
    </div>
  );
}
