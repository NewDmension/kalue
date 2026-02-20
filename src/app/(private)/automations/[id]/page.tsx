'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';
import { Plus, Save, Link2, X } from 'lucide-react';

type WorkflowStatus = 'draft' | 'active' | 'paused';

function normalizeStatus(v: unknown): WorkflowStatus {
  return v === 'active' || v === 'paused' || v === 'draft' ? v : 'draft';
}

type Workflow = { id: string; name: string; status: WorkflowStatus };

type NodeUI = { x: number; y: number };

type NodeRow = {
  id: string;
  type: string;
  name: string;
  config: unknown;
  ui: unknown;
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

type EdgeVM = EdgeRow;

type GetResponse =
  | { ok: true; workflow: { id: string; name: string; status: string }; nodes: NodeRow[]; edges: EdgeRow[] }
  | { ok: false; error: string; detail?: string };

type UpsertGraphResponse = { ok: true } | { ok: false; error: string; detail?: string };

type SetStatusResponse = { ok: true } | { ok: false; error: string; detail?: string };

// ---- Tipos/config tipados (MVP) ----
type TriggerEvent = 'lead.stage_changed';
type ActionKind = 'lead.add_label';

type TriggerConfig = { event: TriggerEvent; toStageId?: string };
type ActionAddLabelConfig = { action: ActionKind; label: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function asTriggerConfig(v: unknown): TriggerConfig {
  if (!isRecord(v)) return { event: 'lead.stage_changed' };
  const event: TriggerEvent = v.event === 'lead.stage_changed' ? 'lead.stage_changed' : 'lead.stage_changed';
  const toStageId = typeof v.toStageId === 'string' && v.toStageId.trim() ? v.toStageId.trim() : undefined;
  return { event, toStageId };
}

function asActionAddLabelConfig(v: unknown): ActionAddLabelConfig {
  if (!isRecord(v)) return { action: 'lead.add_label', label: '' };
  const action: ActionKind = 'lead.add_label';
  const label = typeof v.label === 'string' ? v.label : '';
  return { action, label };
}

function parseNodeUi(ui: unknown): NodeUI {
  if (!isRecord(ui)) return { x: 80, y: 80 };
  const x = typeof ui.x === 'number' && Number.isFinite(ui.x) ? ui.x : 80;
  const y = typeof ui.y === 'number' && Number.isFinite(ui.y) ? ui.y : 80;
  return { x, y };
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function uuidv4(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function AutomationBuilderPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params.id;

  const [loading, setLoading] = useState(true);

  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);

  const [wf, setWf] = useState<Workflow | null>(null);
  const [nodes, setNodes] = useState<NodeVM[]>([]);
  const [edges, setEdges] = useState<EdgeVM[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [connectMode, setConnectMode] = useState(false);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);

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
    setPageError(null);
    setActionError(null);
    setActionInfo(null);

    const ws = await getActiveWorkspaceId();
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;

    if (!ws || !token) {
      setPageError(!ws ? 'missing_workspace' : 'login_required');
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
      setPageError(j.detail ?? j.error);
      setLoading(false);
      return;
    }

    setWf({
      id: j.workflow.id,
      name: j.workflow.name,
      status: normalizeStatus(j.workflow.status),
    });

    const vmNodes: NodeVM[] = (Array.isArray(j.nodes) ? j.nodes : [])
      .filter((n): n is NodeRow => Boolean(n && typeof n.id === 'string'))
      .map((n) => {
        const baseConfig: Record<string, unknown> = isRecord(n.config) ? n.config : {};
        const normalizedConfig: Record<string, unknown> =
          n.type === 'trigger'
            ? (asTriggerConfig(baseConfig) as unknown as Record<string, unknown>)
            : n.type === 'action'
              ? (asActionAddLabelConfig(baseConfig) as unknown as Record<string, unknown>)
              : baseConfig;

        return {
          id: n.id,
          type: n.type,
          name: n.name,
          config: normalizedConfig,
          ui: parseNodeUi(n.ui),
        };
      });

    const vmEdges: EdgeVM[] = (Array.isArray(j.edges) ? j.edges : [])
      .filter((e): e is EdgeRow => Boolean(e && typeof e.id === 'string'))
      .map((e) => ({
        id: e.id,
        from_node_id: e.from_node_id,
        to_node_id: e.to_node_id,
        condition_key: e.condition_key,
      }));

    setNodes(vmNodes);

    const nodeIdSet = new Set(vmNodes.map((n) => n.id));
    setEdges(vmEdges.filter((e) => nodeIdSet.has(e.from_node_id) && nodeIdSet.has(e.to_node_id)));

    setLoading(false);
  }, [workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const startDragNode = useCallback(
    (nodeId: string, ev: React.MouseEvent) => {
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
    },
    [nodes]
  );

  const onCanvasClick = useCallback(() => {
    setSelectedNodeId(null);
    setActionInfo(null);
    setActionError(null);
    if (connectMode) setConnectFromId(null);
  }, [connectMode]);

  const onNodeClick = useCallback(
    (nodeId: string) => {
      setActionError(null);
      setActionInfo(null);

      if (!connectMode) {
        setSelectedNodeId(nodeId);
        return;
      }

      if (!connectFromId) {
        setConnectFromId(nodeId);
        setSelectedNodeId(nodeId);
        setActionInfo('Origen seleccionado. Ahora elige el destino…');
        return;
      }

      if (connectFromId === nodeId) return;

      const exists = edges.some((e) => e.from_node_id === connectFromId && e.to_node_id === nodeId);
      if (exists) {
        setActionInfo('Ese enlace ya existe.');
        setConnectFromId(null);
        return;
      }

      const id = uuidv4();
      setEdges((prev) => [...prev, { id, from_node_id: connectFromId, to_node_id: nodeId, condition_key: null }]);
      setConnectFromId(null);
      setSelectedNodeId(nodeId);
      setActionInfo('Conexión creada (no olvides Guardar).');
    },
    [connectMode, connectFromId, edges]
  );

  const createNode = useCallback(
    async (type: 'trigger' | 'action'): Promise<void> => {
      setActionError(null);
      setActionInfo(null);

      const ws = await getActiveWorkspaceId();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      if (!ws || !token) {
        setActionError(!ws ? 'missing_workspace' : 'login_required');
        return;
      }

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

      let rawJson: unknown = null;
      try {
        rawJson = (await res.json()) as unknown;
      } catch {
        rawJson = null;
      }

      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error('node-create http error', res.status, rawJson);
        setActionError(`node_create_http_${res.status}`);
        return;
      }

      if (!isRecord(rawJson)) {
        // eslint-disable-next-line no-console
        console.error('node-create invalid json', rawJson);
        setActionError('node_create_invalid_json');
        return;
      }

      if (rawJson.ok !== true) {
        const err = typeof rawJson.error === 'string' ? rawJson.error : 'node_create_failed';
        const detail = typeof rawJson.detail === 'string' ? rawJson.detail : '';
        // eslint-disable-next-line no-console
        console.error('node-create failed', rawJson);
        setActionError(detail ? `${err}: ${detail}` : err);
        return;
      }

      const nodeUnknown = (rawJson.node ?? rawJson.data) as unknown;

      if (!isRecord(nodeUnknown)) {
        // eslint-disable-next-line no-console
        console.error('node-create missing node', rawJson);
        setActionError('node_create_missing_node');
        return;
      }

      const id = typeof nodeUnknown.id === 'string' ? nodeUnknown.id : '';
      const nodeType = typeof nodeUnknown.type === 'string' ? nodeUnknown.type : type;
      const name = typeof nodeUnknown.name === 'string' ? nodeUnknown.name : type === 'trigger' ? 'Trigger' : 'Acción';

      if (!id) {
        // eslint-disable-next-line no-console
        console.error('node-create invalid node.id', nodeUnknown);
        setActionError('node_create_invalid_node_id');
        return;
      }

      const ui = parseNodeUi(nodeUnknown.ui);

      const rawConfig: unknown = nodeUnknown.config;
      const normalizedConfig: Record<string, unknown> =
        nodeType === 'trigger'
          ? (asTriggerConfig(rawConfig) as unknown as Record<string, unknown>)
          : nodeType === 'action'
            ? (asActionAddLabelConfig(rawConfig) as unknown as Record<string, unknown>)
            : isRecord(rawConfig)
              ? rawConfig
              : {};

      const node: NodeVM = { id, type: nodeType, name, config: normalizedConfig, ui };

      setNodes((prev) => [...prev, node]);
      setSelectedNodeId(node.id);
      setActionInfo(`${type === 'trigger' ? 'Trigger' : 'Acción'} creado.`);
    },
    [workflowId]
  );

  const saveGraph = useCallback(async (): Promise<void> => {
    setActionError(null);
    setActionInfo(null);

    const ws = await getActiveWorkspaceId();
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;

    if (!ws || !token) {
      setActionError(!ws ? 'missing_workspace' : 'login_required');
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
      // eslint-disable-next-line no-console
      console.error('upsert-graph failed', j);
      setActionError(j.detail ?? j.error);
      return;
    }

    setActionInfo('Guardado.');
  }, [workflowId, nodes, edges]);

  const setWorkflowStatus = useCallback(
    async (nextStatus: WorkflowStatus): Promise<void> => {
      setActionError(null);
      setActionInfo(null);

      const ws = await getActiveWorkspaceId();
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      if (!ws || !token) {
        setActionError(!ws ? 'missing_workspace' : 'login_required');
        return;
      }

      const res = await fetch('/api/automations/workflows/set-status', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-workspace-id': ws,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ workflowId, status: nextStatus }),
      });

      const j = (await res.json()) as SetStatusResponse;
      if (!j.ok) {
        // eslint-disable-next-line no-console
        console.error('set-status failed', j);
        setActionError('detail' in j && typeof j.detail === 'string' ? j.detail : j.error);
        return;
      }

      setWf((prev) => (prev ? { ...prev, status: nextStatus } : prev));
      setActionInfo(nextStatus === 'active' ? 'Workflow activado.' : nextStatus === 'paused' ? 'Workflow pausado.' : 'Workflow en borrador.');
    },
    [workflowId]
  );

  const updateSelectedName = useCallback(
    (name: string) => {
      setNodes((prev) => prev.map((n) => (n.id === selectedNodeId ? { ...n, name } : n)));
    },
    [selectedNodeId]
  );

  const deleteSelected = useCallback(() => {
    const id = selectedNodeId;
    if (!id) return;

    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from_node_id !== id && e.to_node_id !== id));
    setSelectedNodeId(null);
    if (connectFromId === id) setConnectFromId(null);
    setActionInfo('Nodo eliminado (no olvides Guardar).');
  }, [selectedNodeId, connectFromId]);

  const updateSelectedTriggerConfig = useCallback(
    (next: TriggerConfig) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === selectedNodeId ? { ...n, config: next as unknown as Record<string, unknown> } : n))
      );
    },
    [selectedNodeId]
  );

  const updateSelectedActionConfig = useCallback(
    (next: ActionAddLabelConfig) => {
      setNodes((prev) =>
        prev.map((n) => (n.id === selectedNodeId ? { ...n, config: next as unknown as Record<string, unknown> } : n))
      );
    },
    [selectedNodeId]
  );

  const edgesSvg = useMemo((): ReactElement[] => {
    const map = new Map<string, NodeVM>();
    for (const n of nodes) map.set(n.id, n);

    const out: ReactElement[] = [];
    for (const e of edges) {
      const a = map.get(e.from_node_id);
      const b = map.get(e.to_node_id);
      if (!a || !b) continue;

      const x1 = a.ui.x + 150;
      const y1 = a.ui.y + 30;
      const x2 = b.ui.x;
      const y2 = b.ui.y + 30;

      out.push(
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
    }

    return out;
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

  if (pageError || !wf) {
    return (
      <div className="p-6">
        <div className="card-glass rounded-2xl border border-red-400/30 bg-red-500/10 p-6 backdrop-blur">
          <div className="text-white/90 font-medium">Error</div>
          <div className="mt-2 text-sm text-white/70">{pageError ?? 'not_found'}</div>
        </div>
      </div>
    );
  }

  const connectHint =
    connectMode && connectFromId ? 'Selecciona un nodo destino…' : connectMode ? 'Selecciona un nodo origen…' : null;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-white/95">{wf.name}</h1>
          <p className="text-sm text-white/60">
            Builder v1 — crea nodos, muévelos, conéctalos y guarda.
            {connectHint ? <span className="ml-2 text-white/70">{connectHint}</span> : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cx(
              'rounded-full border px-3 py-1 text-xs',
              wf.status === 'active'
                ? 'border-emerald-400/30 bg-emerald-500/15 text-white/85'
                : wf.status === 'paused'
                  ? 'border-amber-400/30 bg-amber-500/15 text-white/85'
                  : 'border-white/10 bg-white/5 text-white/70'
            )}
          >
            {wf.status === 'active' ? 'Activo' : wf.status === 'paused' ? 'Pausado' : 'Borrador'}
          </span>

          <button
            type="button"
            onClick={() => void setWorkflowStatus(wf.status === 'active' ? 'paused' : 'active')}
            className={cx(
              'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition',
              wf.status === 'active'
                ? 'border-amber-400/25 bg-amber-500/15 text-white hover:bg-amber-500/25'
                : 'border-emerald-400/25 bg-emerald-500/15 text-white hover:bg-emerald-500/25'
            )}
            title={wf.status === 'active' ? 'Pausar' : 'Activar'}
          >
            {wf.status === 'active' ? 'Pausar' : 'Activar'}
          </button>

          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setActionInfo(null);
              setConnectMode((v) => !v);
              setConnectFromId(null);
            }}
            className={cx(
              'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition',
              connectMode
                ? 'border-indigo-400/30 bg-indigo-500/20 text-white'
                : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
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

      {actionError ? (
        <div className="mb-3 card-glass rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-white/80">
          {actionError}
        </div>
      ) : null}

      {actionInfo ? (
        <div className="mb-3 card-glass rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white/75">
          {actionInfo}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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

          <div ref={canvasRef} onClick={onCanvasClick} className="absolute inset-0 overflow-hidden rounded-2xl">
            <svg className="absolute inset-0 h-full w-full">{edgesSvg}</svg>

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
            <div className="mt-4 space-y-4">
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

              {selectedNode.type === 'trigger' ? (
                <TriggerEditor
                  config={asTriggerConfig(selectedNode.config)}
                  onChange={(next) => updateSelectedTriggerConfig(next)}
                />
              ) : null}

              {selectedNode.type === 'action' ? (
                <ActionAddLabelEditor
                  config={asActionAddLabelConfig(selectedNode.config)}
                  onChange={(next) => updateSelectedActionConfig(next)}
                />
              ) : null}

              <div className="text-xs text-white/55">
                Recuerda pulsar <span className="text-white/75">Guardar</span> para persistir cambios.
              </div>
            </div>
          ) : (
            <div className="mt-4 text-sm text-white/60">Selecciona un nodo para editar.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function TriggerEditor(props: { config: TriggerConfig; onChange: (next: TriggerConfig) => void }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="text-sm font-medium text-white/85">Trigger</div>

      <div className="mt-3">
        <label className="text-xs text-white/60">Evento</label>
        <select
          value={props.config.event}
          onChange={() => props.onChange({ ...props.config, event: 'lead.stage_changed' })}
          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/40"
        >
          <option value="lead.stage_changed">Lead movido de stage</option>
        </select>
      </div>

      <div className="mt-3">
        <label className="text-xs text-white/60">Solo si entra a Stage ID (opcional)</label>
        <input
          value={props.config.toStageId ?? ''}
          onChange={(e) => props.onChange({ ...props.config, toStageId: e.target.value.trim() || undefined })}
          placeholder="stage_uuid (opcional)"
          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/40"
        />
      </div>
    </div>
  );
}

function ActionAddLabelEditor(props: { config: ActionAddLabelConfig; onChange: (next: ActionAddLabelConfig) => void }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="text-sm font-medium text-white/85">Acción</div>

      <div className="mt-3">
        <label className="text-xs text-white/60">Tipo</label>
        <select
          value={props.config.action}
          onChange={() => props.onChange({ ...props.config, action: 'lead.add_label' })}
          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/40"
        >
          <option value="lead.add_label">Añadir etiqueta (label)</option>
        </select>
      </div>

      <div className="mt-3">
        <label className="text-xs text-white/60">Label</label>
        <input
          value={props.config.label}
          onChange={(e) => props.onChange({ ...props.config, label: e.target.value })}
          placeholder="Ej: Movido a Contactado"
          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/40"
        />
      </div>
    </div>
  );
}
