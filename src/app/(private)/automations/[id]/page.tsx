'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getActiveWorkspaceId } from '@/lib/activeWorkspace';

function createBrowserSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  return createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

type Workflow = { id: string; name: string; status: string };
type NodeRow = { id: string; type: string; name: string; config: unknown; ui: unknown };
type EdgeRow = { id: string; from_node_id: string; to_node_id: string; condition_key: string | null };

type GetResponse =
  | { ok: true; workflow: Workflow; nodes: NodeRow[]; edges: EdgeRow[] }
  | { ok: false; error: string; detail?: string };

export default function AutomationBuilderPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params.id;

  const supabase = useMemo(() => createBrowserSupabase(), []);

  const [loading, setLoading] = useState(true);
  const [wf, setWf] = useState<Workflow | null>(null);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [edges, setEdges] = useState<EdgeRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    if (!supabase) {
      setError('missing_supabase_env');
      setLoading(false);
      return;
    }

    const ws = await getActiveWorkspaceId();
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;

    if (!ws || !token) {
      setError(!ws ? 'missing_workspace' : 'login_required');
      setLoading(false);
      return;
    }

    const res = await fetch(`/api/automations/workflows/get?id=${encodeURIComponent(workflowId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-workspace-id': ws,
      },
      cache: 'no-store',
    });

    const j = (await res.json()) as GetResponse;
    if (!j.ok) {
      setError(j.detail ?? j.error);
      setLoading(false);
      return;
    }

    setWf(j.workflow);
    setNodes(j.nodes);
    setEdges(j.edges);
    setLoading(false);
  }, [supabase, workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="card-glass rounded-2xl border border-white/10 bg-black/20 p-6 backdrop-blur">
          Cargando workflow…
        </div>
      </div>
    );
  }

  if (error || !wf) {
    return (
      <div className="p-6">
        <div className="card-glass rounded-2xl border border-red-400/30 bg-red-500/10 p-6 backdrop-blur">
          <div className="text-white/90 font-medium">Error</div>
          <div className="mt-2 text-sm text-white/70">{error ?? 'not_found'}</div>
          {error === 'missing_supabase_env' ? (
            <div className="mt-2 text-sm text-white/60">
              Falta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en Vercel.
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white/95">{wf.name}</h1>
          <p className="text-sm text-white/60">Builder v1 (Paso 4: canvas + drag + conexiones + panel config).</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/80">
          {wf.status}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card-glass rounded-2xl border border-white/10 bg-black/20 p-5 backdrop-blur lg:col-span-2">
          <div className="text-white/90 font-medium">Canvas (placeholder)</div>
          <div className="mt-3 text-white/60 text-sm">
            Aquí irá el canvas con bloques conectados. Por ahora solo cargamos el grafo desde DB.
          </div>
        </div>

        <div className="card-glass rounded-2xl border border-white/10 bg-black/20 p-5 backdrop-blur">
          <div className="text-white/90 font-medium">Estado actual</div>
          <div className="mt-3 text-sm text-white/70">Nodes: {nodes.length}</div>
          <div className="text-sm text-white/70">Edges: {edges.length}</div>

          <div className="mt-4 text-white/80 font-medium text-sm">Nodes</div>
          <div className="mt-2 space-y-2">
            {nodes.slice(0, 6).map((n) => (
              <div key={n.id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <div className="text-white/90 text-sm">{n.name}</div>
                <div className="text-white/50 text-xs">{n.type}</div>
              </div>
            ))}
            {nodes.length > 6 ? <div className="text-xs text-white/50">…</div> : null}
          </div>

          <button
            onClick={() => void load()}
            className="mt-4 inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            Recargar
          </button>
        </div>
      </div>
    </div>
  );
}
