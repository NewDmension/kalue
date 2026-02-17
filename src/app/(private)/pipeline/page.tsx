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
};

type LeadRow = {
  id: string;
  workspace_id: string;
  created_at: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  source: string | null;
  labels: string[] | null;
  notes: string | null;
  stage_id: string; // viene enriquecido en board
  position: number;
  stage_changed_at: string | null;
};

type PipelinesListResponse =
  | { ok: true; pipelines: PipelineRow[] }
  | { ok: false; error: string; detail?: string };

type BoardResponse =
  | { ok: true; stages: StageRow[]; leadsByStage: Record<string, LeadRow[]> }
  | { ok: false; error: string; detail?: string };

type MoveLeadResponse =
  | { ok: true }
  | { ok: false; error: string; detail?: string };

type DragPayload = {
  leadId: string;
  fromStageId: string;
  pipelineId: string;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function safeParseDragPayload(raw: string): DragPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    const leadId = typeof r.leadId === 'string' ? r.leadId : '';
    const fromStageId = typeof r.fromStageId === 'string' ? r.fromStageId : '';
    const pipelineId = typeof r.pipelineId === 'string' ? r.pipelineId : '';
    if (!leadId || !fromStageId || !pipelineId) return null;
    return { leadId, fromStageId, pipelineId };
  } catch {
    return null;
  }
}

export default function PipelinePage() {
  const { activeWorkspaceId } = useWorkspace();

  const [error, setError] = useState<string | null>(null);

  // ✅ Punto 1: lead seleccionado (highlight)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  // Pipelines
  const [pipelinesLoading, setPipelinesLoading] = useState(true);
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);

  // Create pipeline
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Board
  const [boardLoading, setBoardLoading] = useState(false);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [leadsByStage, setLeadsByStage] = useState<Record<string, LeadRow[]>>({});

  const selectedPipeline = useMemo(() => {
    if (!selectedPipelineId) return null;
    return pipelines.find((p) => p.id === selectedPipelineId) ?? null;
  }, [pipelines, selectedPipelineId]);

  async function loadPipelines(): Promise<void> {
    if (!activeWorkspaceId) {
      setPipelines([]);
      setSelectedPipelineId(null);
      setPipelinesLoading(false);
      return;
    }

    setPipelinesLoading(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setError('login_required');
      setPipelinesLoading(false);
      return;
    }

    const res = await fetch('/api/pipelines/list', {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': activeWorkspaceId,
      },
    });

    const raw = (await res.json()) as unknown;
    const parsed = raw as PipelinesListResponse;

    if (!res.ok || !parsed || parsed.ok !== true) {
      const msg =
        typeof (parsed as { error?: string }).error === 'string'
          ? (parsed as { error: string }).error
          : 'failed_to_load_pipelines';
      const detail =
        typeof (parsed as { detail?: string }).detail === 'string'
          ? (parsed as { detail: string }).detail
          : '';
      setError(detail ? `${msg}: ${detail}` : msg);
      setPipelines([]);
      setSelectedPipelineId(null);
      setPipelinesLoading(false);
      return;
    }

    setPipelines(parsed.pipelines);

    const def = parsed.pipelines.find((p) => p.is_default) ?? parsed.pipelines[0] ?? null;
    setSelectedPipelineId(def?.id ?? null);

    setPipelinesLoading(false);
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

    const raw = (await res.json()) as unknown;
    if (!res.ok || typeof raw !== 'object' || raw === null) {
      setError('create_failed');
      setCreating(false);
      return;
    }

    const r = raw as Record<string, unknown>;
    if (r.ok !== true) {
      const msg = typeof r.error === 'string' ? r.error : 'create_failed';
      const detail = typeof r.detail === 'string' ? r.detail : '';
      setError(detail ? `${msg}: ${detail}` : msg);
      setCreating(false);
      return;
    }

    const pipeline = r.pipeline as unknown as PipelineRow | undefined;
    const pipelineId = typeof r.pipelineId === 'string' ? r.pipelineId : null;

    if (!pipeline || !pipelineId) {
      setError('create_failed: bad_return');
      setCreating(false);
      return;
    }

    setNewName('');
    setPipelines((prev) => [pipeline, ...prev]);
    setSelectedPipelineId(pipelineId);

    setCreating(false);
  }

  async function loadBoard(pipelineId: string): Promise<void> {
    if (!activeWorkspaceId) return;

    setBoardLoading(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setError('login_required');
      setBoardLoading(false);
      return;
    }

    const url = new URL('/api/pipelines/board', window.location.origin);
    url.searchParams.set('pipelineId', pipelineId);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': activeWorkspaceId,
      },
    });

    const raw = (await res.json()) as unknown;
    const parsed = raw as BoardResponse;

    if (!res.ok || !parsed || parsed.ok !== true) {
      const msg =
        typeof (parsed as { error?: string }).error === 'string'
          ? (parsed as { error: string }).error
          : 'failed_to_load_board';
      const detail =
        typeof (parsed as { detail?: string }).detail === 'string'
          ? (parsed as { detail: string }).detail
          : '';
      setError(detail ? `${msg}: ${detail}` : msg);
      setStages([]);
      setLeadsByStage({});
      setBoardLoading(false);
      return;
    }

    setStages(parsed.stages);
    setLeadsByStage(parsed.leadsByStage ?? {});
    setBoardLoading(false);
  }

  function optimisticMoveLead(args: { leadId: string; fromStageId: string; toStageId: string; pipelineId: string }): void {
    setLeadsByStage((prev) => {
      const next: Record<string, LeadRow[]> = { ...prev };

      const fromArr = Array.isArray(next[args.fromStageId]) ? [...next[args.fromStageId]!] : [];
      const toArr = Array.isArray(next[args.toStageId]) ? [...next[args.toStageId]!] : [];

      const idx = fromArr.findIndex((l) => l.id === args.leadId);
      if (idx < 0) return prev;

      const lead = fromArr[idx]!;
      fromArr.splice(idx, 1);

      const moved: LeadRow = {
        ...lead,
        stage_id: args.toStageId,
        position: 999999,
        stage_changed_at: new Date().toISOString(),
      };

      toArr.push(moved);

      next[args.fromStageId] = fromArr;
      next[args.toStageId] = toArr;

      return next;
    });
  }

  async function persistMoveLead(args: { leadId: string; toStageId: string; pipelineId: string; toPosition: number }): Promise<boolean> {
    if (!activeWorkspaceId) return false;

    const token = await getAccessToken();
    if (!token) {
      setError('login_required');
      return false;
    }

    const res = await fetch('/api/pipelines/move-lead', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': activeWorkspaceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        pipelineId: args.pipelineId,
        leadId: args.leadId,
        toStageId: args.toStageId,
        toPosition: args.toPosition,
      }),
    });

    const raw = (await res.json()) as unknown;
    const parsed = raw as MoveLeadResponse;

    if (!res.ok || !parsed || parsed.ok !== true) {
      const msg =
        typeof (parsed as { error?: string }).error === 'string'
          ? (parsed as { error: string }).error
          : 'move_failed';
      const detail =
        typeof (parsed as { detail?: string }).detail === 'string'
          ? (parsed as { detail: string }).detail
          : '';
      setError(detail ? `${msg}: ${detail}` : msg);
      return false;
    }

    return true;
  }

  // Load pipelines on workspace change
  useEffect(() => {
    void loadPipelines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  // Load board when pipeline selected
  useEffect(() => {
    setSelectedLeadId(null); // reset selección al cambiar pipeline/workspace
    if (!selectedPipelineId) {
      setStages([]);
      setLeadsByStage({});
      return;
    }
    void loadBoard(selectedPipelineId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPipelineId, activeWorkspaceId]);

  // Drag handlers
  function onDragStartLead(e: React.DragEvent, payload: DragPayload): void {
    const data = safeJsonStringify(payload);
    e.dataTransfer.setData('application/json', data);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOverColumn(e: React.DragEvent): void {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  async function onDropColumn(e: React.DragEvent, toStageId: string): Promise<void> {
    e.preventDefault();

    const raw = e.dataTransfer.getData('application/json');
    const payload = safeParseDragPayload(raw);
    if (!payload) return;

    if (!selectedPipelineId) return;
    if (payload.pipelineId !== selectedPipelineId) return;

    if (payload.fromStageId === toStageId) return;

    // Optimistic
    optimisticMoveLead({
      leadId: payload.leadId,
      fromStageId: payload.fromStageId,
      toStageId,
      pipelineId: payload.pipelineId,
    });

    const ok = await persistMoveLead({
      leadId: payload.leadId,
      pipelineId: payload.pipelineId,
      toStageId,
      toPosition: 999999,
    });

    if (!ok) {
      await loadBoard(payload.pipelineId);
    }
  }

  const boardHasStages = stages.length > 0;

  return (
    <div className="card-glass border border-white/10 rounded-2xl p-6 text-white">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Pipeline</h1>
          <p className="mt-2 text-sm text-white/70">Kanban por stages. Arrastra leads entre columnas.</p>
        </div>

        <div className="flex flex-col gap-2 md:items-end">
          <div className="flex items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nuevo pipeline (ej: Ventas)"
              className="w-full md:w-[260px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-indigo-400/30"
            />
            <button
              type="button"
              onClick={() => void createPipeline()}
              disabled={creating || newName.trim().length === 0 || !activeWorkspaceId}
              className={cx(
                'rounded-xl border px-3 py-2 text-sm',
                creating || newName.trim().length === 0 || !activeWorkspaceId
                  ? 'border-white/10 bg-white/5 text-white/40'
                  : 'border-indigo-400/25 bg-indigo-500/10 text-white hover:bg-indigo-500/15'
              )}
            >
              {creating ? 'Creando…' : 'Crear'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-white/55">Pipeline:</span>
            <select
              value={selectedPipelineId ?? ''}
              onChange={(e) => setSelectedPipelineId(e.target.value || null)}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
              disabled={pipelinesLoading || pipelines.length === 0}
            >
              <option value="" disabled>
                {pipelinesLoading ? 'Cargando…' : 'Selecciona'}
              </option>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {/* ✅ BOARD con altura fija + scroll por columna */}
      <div className="mt-6">
        {boardLoading ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
            Cargando board…
          </div>
        ) : !boardHasStages ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
            {selectedPipeline ? 'Este pipeline no tiene stages.' : 'Selecciona un pipeline.'}
          </div>
        ) : (
          <div
            className={cx(
              'rounded-2xl border border-white/10 bg-black/10 p-3',
              // altura “tipo app”: ajusta si quieres (depende de tu topbar)
              'h-[calc(100vh-320px)] min-h-[420px]'
            )}
          >
            {/* Scroll horizontal si hay muchas columnas */}
            <div className="h-full overflow-x-auto">
              <div className="flex h-full gap-4 pr-2">
                {stages.map((st) => {
                  const items = Array.isArray(leadsByStage[st.id]) ? leadsByStage[st.id]! : [];

                  return (
                    <div
                      key={st.id}
                      onDragOver={onDragOverColumn}
                      onDrop={(e) => void onDropColumn(e, st.id)}
                      className={cx(
                        'flex h-full w-[290px] shrink-0 flex-col rounded-2xl border border-white/10 bg-white/5 p-3',
                        'transition'
                      )}
                    >
                      {/* Header columna */}
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white/90 truncate">{st.name}</p>
                        <span className="text-xs text-white/55">{items.length}</span>
                      </div>

                      {/* Lista con scroll */}
                      <div className="mt-3 flex-1 overflow-y-auto pr-1">
                        <div className="flex flex-col gap-2">
                          {items.map((lead) => {
                            const isSelected = selectedLeadId === lead.id;

                            return (
                              <div
                                key={lead.id}
                                draggable
                                onDragStart={(e) => {
                                  if (!selectedPipelineId) return;
                                  onDragStartLead(e, {
                                    leadId: lead.id,
                                    fromStageId: st.id,
                                    pipelineId: selectedPipelineId,
                                  });
                                }}
                                onClick={() => setSelectedLeadId(lead.id)}
                                className={cx(
                                  'cursor-grab active:cursor-grabbing rounded-xl border bg-black/25 p-3 transition',
                                  isSelected
                                    ? 'border-indigo-400/60 ring-2 ring-indigo-400/30'
                                    : 'border-white/10 hover:bg-black/30 hover:border-white/20'
                                )}
                                role="button"
                                tabIndex={0}
                              >
                                <p className="text-sm font-semibold text-white truncate">
                                  {lead.full_name ?? 'Sin nombre'}
                                </p>

                                <div className="mt-1 space-y-1">
                                  {lead.email ? (
                                    <p className="text-[12px] text-white/70 truncate">{lead.email}</p>
                                  ) : null}

                                  {lead.phone ? (
                                    <p className="text-[12px] text-white/70 truncate">{lead.phone}</p>
                                  ) : null}

                                  <div className="flex items-center gap-2 pt-1">
                                    {lead.source ? (
                                      <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
                                        {lead.source}
                                      </span>
                                    ) : null}

                                    <span className="text-[11px] text-white/45">
                                      {new Date(lead.created_at).toLocaleString()}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          {items.length === 0 ? (
                            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                              Suelta aquí…
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
        <p className="text-sm font-semibold text-white/90">Estado</p>
        <p className="mt-1 text-sm text-white/60">
          Workspace: <span className="text-white/85">{activeWorkspaceId ?? '—'}</span> · Pipeline:{' '}
          <span className="text-white/85">{selectedPipeline?.name ?? '—'}</span>
        </p>
      </div>
    </div>
  );
}
