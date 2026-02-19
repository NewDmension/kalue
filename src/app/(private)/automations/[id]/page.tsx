'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';
import { Plus, Save, Link2, X } from 'lucide-react';

type Workflow = { id: string; name: string; status: string };

type NodeUI = { x: number; y: number };

type NodeRow = {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown> | null;
  ui: Record<string, unknown> | null;
};

type NodeVM = {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  ui: NodeUI;
};

type EdgeRow = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  condition_key: string | null;
};

type EdgeVM = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  condition_key: string | null;
};

type GetResponse =
  | { ok: true; workflow: Workflow; nodes: NodeRow[]; edges: EdgeRow[] }
  | { ok: false; error: string; detail?: string };

type NodeCreateResponse =
  | { ok: true; node: { id: string; type: string; name: string; config: unknown; ui: unknown } }
  | { ok: false; error: string; detail?: string };

type UpsertGraphResponse = { ok: true } | { ok: false; error: string; detail?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseNodeUi(ui: Record<string, unknown> | null): NodeUI {
  const x = ui && typeof ui.x === 'number' && Number.isFinite(ui.x) ? ui.x : 80;
  const y = ui && typeof ui.y === 'number' && Number.isFinite(ui.y) ? ui.y : 80;
  return { x, y };
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function newEdgeId(): string {
  // simple client id; DB will accept any uuid if you used uuid type.
  // If your DB enforces UUID format strictly and doesn't accept this, I’ll switch to server endpoint for edges too.
  return crypto.randomUUID();
}

export default function AutomationBuilderPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params.id;

  const [loading, setLoading] = useState(true);
  const [wf, setWf] = useState<Workflow | null>(null);
  const [nodes, setNodes] = useState<NodeVM[]>([]);
  const [edges, setEdges] = useState<EdgeVM[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Connect mode
  const [connectMode, setConnectMode] = useState(false);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);

  // Drag node
  const draggingRef = useRef<{
    nodeId: string;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

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

    const vmNodes: NodeVM[] = j.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      config: isRecord(n.config) ? n.config : {},
      ui: parseNodeUi(isRecord(n.ui) ? n.ui : null),
    }));

    const vmEdges: EdgeVM[] = j.edges.map((e) => ({
      id: e.id,
      from_node_id: e.from_node_id,
      to_node_id: e.to_node_id,
      condition_key: e.condition_key,
    }));

    setNodes(vmNodes);
    setEdges(vmEdges);
    setLoading(false);
  }, [workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Mouse move/up for dragging
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const d = draggingRef.current;
      if (!d) return;
      ev.preventDefault();

      const dx = ev.clientX - d.startMouseX;
      const dy = ev.clientY - d.startMouseY;

      setNodes((prev) =>
        prev.map((n) => (n.id === d.nodeId ? { ...n, ui: { x: d.startX + dx, y: d.startY + dy } } : n))
      );
    };

    const onUp = () => {
      draggingRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDragNode = useCallback((nodeId: string, ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const n = nodes.find((x) => x.id === nodeId);
    if (!n) return;

    setSelectedNodeId(nodeId);

    draggingRef.current = {
      nodeId,
      startMouseX: ev.clientX,
      startMouseY: ev.clientY,
      startX: n.ui.x,
      startY: n.ui.y,
    };
  }, [nodes]);

  const onCanvasClick = useCallback(() => {
    setSelectedNodeId(null);
    if (connectMode) {
      setConnectFromId(null);
    }
  }, [connectMode]);

  const onNodeClick = useCallback(
    (nodeId: string) => {
      if (!connectMode) {
        setSelectedNodeId(nodeId);
        return;
      }

      // connect mode
      if (!connectFromId) {
        setConnectFromId(nodeId);
        setSelectedNodeId(nodeId);
        return;
      }

      if (connectFromId === nodeId) return;

      // create edge
      const exists = edges.some((e) => e.from_node_id === connectFromId && e.to_node_id === nodeId);
      if (exists) return;

      const id = newEdgeId();
      setEdges((prev) => [...prev, { id, from_node_id: connectFromId, to_node_id: nodeId, condition_key: null }]);
      setConnectFromId(null);
      setSelectedNodeId(nodeId);
    },
    [connectMode, connectFromId, edges]
  );

  const createNode = useCallback(
    async (type: 'trigger' | 'action'): Promise<void> => {
      setError(null);

      const ws = await getActiveWorkspaceId();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      if (!ws || !token) {
        setError(!ws ? 'missing_workspace' : 'login_required');
        return;
      }

      // place near center-ish
      const rect = canvasRef.current?.getBoundingClientRect() ?? null;
      const x = rect ? Math.max(40, rect.width / 2 - 80) : 120;
      const y = rect ? Math.max(40, rect.height / 2 - 40) : 120;

      const res = await fetch('/api/automations/workflows/node-create', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-workspace-id': ws,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          workflowId,
          type,
          name: type === 'trigger' ? 'Trigger' : 'Acción',
          x,
          y,
        }),
      });

      const j = (await res.json()) as NodeCreateResponse;
      if (!j.ok) {
        setError(j.detail ?? j.error);
        return;
      }

      const raw = j.node;
      const ui = isRecord(raw.ui) ? parseNodeUi(raw.ui) : { x, y };
      const config = isRecord(raw.config) ? raw.config : {};

      const node: NodeVM = {
        id: raw.id,
        type: raw.type,
        name: raw.name,
        config,
        ui,
      };

      setNodes((prev) => [...prev, node]);
      setSelectedNodeId(node.id);
    },
    [workflowId]
  );

  const saveGraph = useCallback(async (): Promise<void> => {
    setError(null);

    const ws = await getActiveWorkspaceId();
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;

    if (!ws || !token) {
      setError(!ws ? 'missing_workspace' : 'login_required');
      return;
    }

    const payload = {
      workflowId,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        name: n.name,
        config: n.config,
        ui: n.ui,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        from_node_id: e.from_node_id,
        to_node_id: e.to_node_id,
        condition_key: e.condition_key,
      })),
    };

    const res = await fetch('/api/automations/workflows/upsert-graph', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-workspace-id': ws,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const j = (await res.json()) as UpsertGraphResponse;
    if (!j.ok) {
      setError(j.detail ?? j.error);
      return;
    }
  }, [workflowId, nodes, edges]);

  const updateSelectedName = useCallback((name: string) => {
    setNodes((prev) => prev.map((n) => (n.id === selectedNodeId ? { ...n, name } : n)));
  }, [selectedNodeId]);

  const deleteSelected = useCallback(() => {
    const id = selectedNodeId;
    if (!id) return;

    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from_node_id !== id && e.to_node_id !== id));
    setSelectedNodeId(null);
    if (connectFromId === id) setConnectFromId(null);
  }, [selectedNodeId, connectFromId]);

  const edgesSvg = useMemo(() => {
    const map = new Map<string, NodeVM>();
    for (const n of nodes) map.set(n.id, n);

    return edges
      .map((e) => {
        const a = map.get(e.from_node_id);
        const b = map.get(e.to_node_id);
        if (!a || !b) return null;

        const x1 = a.ui.x + 150;
        const y1 = a.ui.y + 30;
        const x2 = b.ui.x;
        const y2 = b.ui.y + 30;

        return (
          <line
            key={e.id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="rgba(255,255,255,0.25)"
            strokeWidth={2}
          />
        );
      })
      .filter(Boolean);
  }, [nodes, edges]);

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
        </div>
      </div>
    );
  }

  const connectHint =
    connectMode && connectFromId ? 'Selecciona un nodo destino…' : connectMode ? 'Selecciona un nodo origen…' : null;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-white/95">{wf.name}</h1>
          <p className="text-sm text-white/60">
            Builder v1 — crea nodos, muévelos, conéctalos y guarda.
            {connectHint ? <span className="ml-2 text-white/70">{connectHint}</span> : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConnectMode((v) => !v)}
            className={cx(
              'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition',
              connectMode ? 'border-indigo-400/30 bg-indigo-500/20 text-white' : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
            )}
            title="Conectar nodos"
          >
            <Link2 className="h-4 w-4" />
            Conectar
          </button>

          <button
            type="button"
            onClick={() => void saveGraph()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-emerald-500/15 px-3 py-2 text-sm text-white hover:bg-emerald-500/25"
            title="Guardar"
          >
            <Save className="h-4 w-4" />
            Guardar
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 card-glass rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-white/80">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Canvas */}
        <div className="card-glass relative h-[70vh] rounded-2xl border border-white/10 bg-black/20 backdrop-blur lg:col-span-2">
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void createNode('trigger')}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-indigo-500/20 px-3 py-2 text-sm text-white hover:bg-indigo-500/30"
            >
              <Plus className="h-4 w-4" />
              Trigger
            </button>

            <button
              type="button"
              onClick={() => void createNode('action')}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 hover:bg-white/10"
            >
              <Plus className="h-4 w-4" />
              Acción
            </button>
          </div>

          <div
            ref={canvasRef}
            onClick={onCanvasClick}
            className="absolute inset-0 overflow-hidden rounded-2xl"
          >
            {/* Lines layer */}
            <svg className="absolute inset-0 h-full w-full">
              {edgesSvg}
            </svg>

            {/* Nodes layer */}
            {nodes.map((n) => {
              const isSelected = n.id === selectedNodeId;
              const isConnectFrom = connectMode && connectFromId === n.id;

              return (
                <div
                  key={n.id}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onNodeClick(n.id);
                  }}
                  style={{ transform: `translate(${n.ui.x}px, ${n.ui.y}px)` }}
                  className={cx(
                    'absolute left-0 top-0 w-[150px] cursor-default select-none rounded-2xl border p-3 shadow-sm transition',
                    isSelected ? 'border-indigo-400/35 bg-indigo-500/15' : 'border-white/10 bg-white/5 hover:bg-white/10',
                    isConnectFrom ? 'ring-2 ring-indigo-300/50' : null
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-white/90">{n.name}</div>
                      <div className="text-[11px] text-white/50">{n.type}</div>
                    </div>

                    <button
                      type="button"
                      onMouseDown={(ev) => startDragNode(n.id, ev)}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10"
                      title="Arrastrar"
                    >
                      ⋮⋮
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel derecho */}
        <div className="card-glass rounded-2xl border border-white/10 bg-black/20 p-5 backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="text-white/90 font-medium">Configuración</div>
            {selectedNode ? (
              <button
                type="button"
                onClick={deleteSelected}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                title="Quitar nodo"
              >
                <X className="h-4 w-4" />
                Eliminar
              </button>
            ) : null}
          </div>

          {selectedNode ? (
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-white/60">Nombre</label>
                <input
                  value={selectedNode.name}
                  onChange={(e) => updateSelectedName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/40"
                />
              </div>

              <div>
                <label className="text-xs text-white/60">Tipo</label>
                <div className="mt-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
                  {selectedNode.type}
                </div>
              </div>

              <div>
                <label className="text-xs text-white/60">Posición</label>
                <div className="mt-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
                  x: {Math.round(selectedNode.ui.x)} · y: {Math.round(selectedNode.ui.y)}
                </div>
              </div>

              <div className="text-xs text-white/55">
                Siguiente: aquí pondremos config fuerte por bloque (trigger/action/condition/wait).
              </div>
            </div>
          ) : (
            <div className="mt-4 text-sm text-white/60">
              Selecciona un nodo para editar.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
