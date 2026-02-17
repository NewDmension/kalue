// src/app/(private)/pipeline/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useWorkspace } from '@/components/app/WorkspaceContext';

type PipelineRow = {
  id: string;
  workspace_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

type StageRow = {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  color: string | null;
  is_won: boolean;
  is_lost: boolean;
  created_at: string;
  updated_at: string;
};

type PipelinesListResponse =
  | { ok: true; pipelines: PipelineRow[] }
  | { ok: false; error: string; detail?: string };

type CreatePipelineResponse =
  | { ok: true; pipelineId: string; pipeline: PipelineRow; stages: StageRow[] }
  | { ok: false; error: string; detail?: string };

type StagesResponse =
  | { ok: true; stages: StageRow[] }
  | { ok: false; error: string; detail?: string };

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export default function PipelinePage() {
  const { activeWorkspaceId } = useWorkspace();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);

  const [stages, setStages] = useState<StageRow[]>([]);
  const [stagesLoading, setStagesLoading] = useState(false);

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const selectedPipeline = useMemo(() => {
    if (!selectedPipelineId) return null;
    return pipelines.find((p) => p.id === selectedPipelineId) ?? null;
  }, [pipelines, selectedPipelineId]);

  async function loadPipelines(): Promise<void> {
    if (!activeWorkspaceId) {
      setPipelines([]);
      setSelectedPipelineId(null);
      setStages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setError('login_required');
      setLoading(false);
      return;
    }

    const res = await fetch('/api/pipelines/list', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': activeWorkspaceId,
      },
    });

    const data = (await res.json()) as unknown;

    const parsed = data as PipelinesListResponse;
    if (!res.ok || !parsed || parsed.ok !== true) {
      const msg =
        typeof (parsed as { error?: string }).error === 'string'
          ? (parsed as { error: string }).error
          : 'failed_to_load';
      const detail =
        typeof (parsed as { detail?: string }).detail === 'string' ? (parsed as { detail: string }).detail : '';
      setError(detail ? `${msg}: ${detail}` : msg);
      setPipelines([]);
      setSelectedPipelineId(null);
      setStages([]);
      setLoading(false);
      return;
    }

    setPipelines(parsed.pipelines);

    // Auto-select: default o primero
    const def = parsed.pipelines.find((p) => p.is_default) ?? parsed.pipelines[0] ?? null;
    setSelectedPipelineId(def?.id ?? null);

    setLoading(false);
  }

  async function loadStages(pipelineId: string): Promise<void> {
    if (!activeWorkspaceId) return;

    setStagesLoading(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setError('login_required');
      setStagesLoading(false);
      return;
    }

    const url = new URL('/api/pipelines/stages', window.location.origin);
    url.searchParams.set('pipelineId', pipelineId);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': activeWorkspaceId,
      },
    });

    const data = (await res.json()) as unknown;
    const parsed = data as StagesResponse;

    if (!res.ok || !parsed || parsed.ok !== true) {
      const msg =
        typeof (parsed as { error?: string }).error === 'string'
          ? (parsed as { error: string }).error
          : 'failed_to_load_stages';
      const detail =
        typeof (parsed as { detail?: string }).detail === 'string' ? (parsed as { detail: string }).detail : '';
      setError(detail ? `${msg}: ${detail}` : msg);
      setStages([]);
      setStagesLoading(false);
      return;
    }

    setStages(parsed.stages);
    setStagesLoading(false);
  }

  async function createPipeline(): Promise<void> {
    if (!activeWorkspaceId) return;

    const name = newName.trim();
    if (!name) return;

    setCreating(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setError('login_required');
      setCreating(false);
      return;
    }

    const res = await fetch('/api/pipelines/create', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': activeWorkspaceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });

    const data = (await res.json()) as unknown;
    const parsed = data as CreatePipelineResponse;

    if (!res.ok || !parsed || parsed.ok !== true) {
      const msg =
        typeof (parsed as { error?: string }).error === 'string'
          ? (parsed as { error: string }).error
          : 'create_failed';
      const detail =
        typeof (parsed as { detail?: string }).detail === 'string' ? (parsed as { detail: string }).detail : '';
      setError(detail ? `${msg}: ${detail}` : msg);
      setCreating(false);
      return;
    }

    setNewName('');

    // Añadimos al listado y seleccionamos
    setPipelines((prev) => [parsed.pipeline, ...prev]);
    setSelectedPipelineId(parsed.pipelineId);
    setStages(parsed.stages);

    setCreating(false);
  }

  useEffect(() => {
    void loadPipelines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!selectedPipelineId) {
      setStages([]);
      return;
    }
    void loadStages(selectedPipelineId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPipelineId, activeWorkspaceId]);

  return (
    <div className="card-glass border border-white/10 rounded-2xl p-6 text-white">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pipeline</h1>
          <p className="mt-2 text-sm text-white/70">
            Crea y gestiona tus pipelines. El kanban (drag &amp; drop) lo montamos justo después.
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Left: Pipelines list */}
        <div className="md:col-span-1">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white/90">Tus pipelines</p>
              {loading ? <span className="text-xs text-white/50">Cargando…</span> : null}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nombre (ej: Ventas)"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-indigo-400/30"
              />
              <button
                type="button"
                onClick={() => void createPipeline()}
                disabled={creating || newName.trim().length === 0 || !activeWorkspaceId}
                className={cx(
                  'shrink-0 rounded-xl border px-3 py-2 text-sm',
                  creating || newName.trim().length === 0 || !activeWorkspaceId
                    ? 'border-white/10 bg-white/5 text-white/40'
                    : 'border-indigo-400/25 bg-indigo-500/10 text-white hover:bg-indigo-500/15',
                )}
              >
                {creating ? 'Creando…' : 'Crear'}
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {!loading && pipelines.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                  No tienes pipelines aún. Crea el primero arriba.
                </div>
              ) : null}

              {pipelines.map((p) => {
                const isActive = p.id === selectedPipelineId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPipelineId(p.id)}
                    className={cx(
                      'w-full rounded-xl border px-3 py-2 text-left text-sm transition',
                      isActive
                        ? 'border-indigo-400/30 bg-indigo-500/10 text-white'
                        : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{p.name}</span>
                      {p.is_default ? (
                        <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
                          Default
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Selected pipeline + stages */}
        <div className="md:col-span-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-white/60">Seleccionado</p>
                <p className="truncate text-base font-semibold text-white">
                  {selectedPipeline?.name ?? '—'}
                </p>
              </div>
              {stagesLoading ? <span className="text-xs text-white/50">Cargando stages…</span> : null}
            </div>

            <div className="mt-4">
              <p className="text-sm font-semibold text-white/90">Stages</p>

              {selectedPipelineId && !stagesLoading && stages.length === 0 ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/70">
                  Este pipeline no tiene stages (raro). Si lo acabas de crear debería venir con default stages.
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {stages.map((s) => (
                  <span
                    key={s.id}
                    className={cx(
                      'rounded-xl border px-3 py-1 text-xs',
                      s.is_won
                        ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-100'
                        : s.is_lost
                          ? 'border-red-400/25 bg-red-500/10 text-red-100'
                          : 'border-white/10 bg-white/5 text-white/80',
                    )}
                  >
                    {s.name}
                  </span>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-sm font-semibold text-white/90">Kanban</p>
                <p className="mt-1 text-sm text-white/60">
                  Siguiente paso: aquí pintamos columnas por stage + cards de leads y activamos drag &amp; drop usando
                  <span className="text-white/85"> lead_pipeline_state </span>
                  (pipeline_id + stage_id + position).
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
