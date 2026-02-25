'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useId } from 'react';
import type { ReactElement } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';
import { Plus, Save, Link2, X, ZoomIn, ZoomOut, LocateFixed } from 'lucide-react';

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

/* ======================
   Canvas pro: pan + zoom + edges bezier + handles
====================== */

const NODE_W = 190;
const NODE_H = 78;
const GRID_BASE = 40;

type Viewport = { x: number; y: number; scale: number };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function toWorld(p: { x: number; y: number }, view: Viewport): { x: number; y: number } {
  return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
}

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(90, Math.abs(x2 - x1) * 0.5);
  const c1x = x1 + dx;
  const c1y = y1;
  const c2x = x2 - dx;
  const c2y = y2;
  return `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
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

  // Connect mode (lo mantenemos para el botón, pero conectamos por handles)
  const [connectMode, setConnectMode] = useState(false);

  // Drag node
  const draggingRef = useRef<{
    nodeId: string;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
    viewAtStart: Viewport;
  } | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Viewport: pan + zoom
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Panning state
  const isSpaceDownRef = useRef(false);
  const panningRef = useRef<{
    startClientX: number;
    startClientY: number;
    startViewX: number;
    startViewY: number;
  } | null>(null);

  // Live connecting via handles
  const connectDragRef = useRef<{
    fromId: string;
    mouseWorld: { x: number; y: number };
  } | null>(null);

  const arrowId = useId();

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

    // Fit-ish inicial (centrar algo si hay nodos)
    if (vmNodes.length > 0) {
      const minX = Math.min(...vmNodes.map((n) => n.ui.x));
      const minY = Math.min(...vmNodes.map((n) => n.ui.y));
      setView({ x: 60 - minX, y: 90 - minY, scale: 1 });
    } else {
      setView({ x: 0, y: 0, scale: 1 });
    }

    setLoading(false);
  }, [workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Space to pan
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') {
        isSpaceDownRef.current = true;
      }
    };
    const onKeyUp = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') {
        isSpaceDownRef.current = false;
        panningRef.current = null;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Global mouse move/up for node drag + connect preview + pan
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      // Node drag
      const d = draggingRef.current;
      if (d) {
        ev.preventDefault();

        const dx = (ev.clientX - d.startMouseX) / d.viewAtStart.scale;
        const dy = (ev.clientY - d.startMouseY) / d.viewAtStart.scale;

        setNodes((prev) =>
          prev.map((n) => (n.id === d.nodeId ? { ...n, ui: { x: d.startX + dx, y: d.startY + dy } } : n))
        );
        return;
      }

      // Pan
      const p = panningRef.current;
      if (p) {
        ev.preventDefault();
        const dx = ev.clientX - p.startClientX;
        const dy = ev.clientY - p.startClientY;
        setView((prev) => ({ ...prev, x: p.startViewX + dx, y: p.startViewY + dy }));
        return;
      }

      // Connect preview
      const c = connectDragRef.current;
      if (c && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const local = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
        c.mouseWorld = toWorld(local, viewRef.current);
      }
    };

    const onUp = () => {
      draggingRef.current = null;
      panningRef.current = null;
      // Si sueltas fuera de un input-handle, cancelamos el cable
      connectDragRef.current = null;
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
        viewAtStart: viewRef.current,
      };
    },
    [nodes]
  );

  const onCanvasClick = useCallback(() => {
    setSelectedNodeId(null);
    setActionInfo(null);
    setActionError(null);
  }, []);

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

      // Centro visible del viewport → a world coords
      const centerLocal = rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 240, y: 180 };
      const centerWorld = toWorld(centerLocal, viewRef.current);

      const x = Math.max(40, centerWorld.x - NODE_W / 2);
      const y = Math.max(40, centerWorld.y - NODE_H / 2);

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
      setActionInfo(
        nextStatus === 'active' ? 'Workflow activado.' : nextStatus === 'paused' ? 'Workflow pausado.' : 'Workflow en borrador.'
      );
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
    setActionInfo('Nodo eliminado (no olvides Guardar).');
  }, [selectedNodeId]);

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

  // Zoom (wheel): zoom to cursor
  const onWheel = useCallback((ev: React.WheelEvent) => {
    if (!canvasRef.current) return;
    ev.preventDefault();

    const rect = canvasRef.current.getBoundingClientRect();
    const local = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };

    const prev = viewRef.current;
    const worldBefore = toWorld(local, prev);

    const delta = ev.deltaY;
    const factor = delta > 0 ? 0.92 : 1.08;
    const nextScale = clamp(prev.scale * factor, 0.35, 2.2);

    const nextX = local.x - worldBefore.x * nextScale;
    const nextY = local.y - worldBefore.y * nextScale;

    setView({ x: nextX, y: nextY, scale: nextScale });
  }, []);

  const zoomBy = useCallback((dir: 'in' | 'out') => {
    const prev = viewRef.current;
    const factor = dir === 'in' ? 1.12 : 0.88;
    const nextScale = clamp(prev.scale * factor, 0.35, 2.2);
    setView((p) => ({ ...p, scale: nextScale }));
  }, []);

  const resetView = useCallback(() => {
    setView({ x: 0, y: 0, scale: 1 });
  }, []);

  const startPan = useCallback((ev: React.MouseEvent) => {
    // Pan si: space pulsado o botón central
    const isMiddle = ev.button === 1;
    if (!isSpaceDownRef.current && !isMiddle) return;

    ev.preventDefault();
    ev.stopPropagation();

    const prev = viewRef.current;
    panningRef.current = {
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      startViewX: prev.x,
      startViewY: prev.y,
    };
  }, []);

  const onNodeClick = useCallback(
    (nodeId: string) => {
      setActionError(null);
      setActionInfo(null);
      setSelectedNodeId(nodeId);
    },
    []
  );

  const beginConnectFrom = useCallback(
    (fromId: string, ev: React.PointerEvent) => {
      if (!connectMode) return;
      ev.preventDefault();
      ev.stopPropagation();

      if (!canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const local = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      const mouseWorld = toWorld(local, viewRef.current);

      connectDragRef.current = { fromId, mouseWorld };
      setActionInfo('Arrastra y suelta en el punto de entrada del nodo destino…');
    },
    [connectMode]
  );

  const completeConnectTo = useCallback(
    (toId: string) => {
      const c = connectDragRef.current;
      if (!connectMode || !c) return;

      if (c.fromId === toId) {
        connectDragRef.current = null;
        return;
      }

      const exists = edges.some((e) => e.from_node_id === c.fromId && e.to_node_id === toId);
      if (exists) {
        setActionInfo('Ese enlace ya existe.');
        connectDragRef.current = null;
        return;
      }

      const id = uuidv4();
      setEdges((prev) => [...prev, { id, from_node_id: c.fromId, to_node_id: toId, condition_key: null }]);
      setSelectedNodeId(toId);
      setActionInfo('Conexión creada (no olvides Guardar).');
      connectDragRef.current = null;
    },
    [connectMode, edges]
  );

  // Edges SVG (curvos + flecha) + preview
  const edgesSvg = useMemo((): ReactElement => {
    const map = new Map<string, NodeVM>();
    for (const n of nodes) map.set(n.id, n);

    const lines: ReactElement[] = [];

    for (const e of edges) {
      const a = map.get(e.from_node_id);
      const b = map.get(e.to_node_id);
      if (!a || !b) continue;

      const x1 = a.ui.x + NODE_W;
      const y1 = a.ui.y + NODE_H / 2;
      const x2 = b.ui.x;
      const y2 = b.ui.y + NODE_H / 2;

      const d = bezierPath(x1, y1, x2, y2);

      lines.push(
        <path
          key={e.id}
          d={d}
          fill="none"
          stroke="rgba(255,255,255,0.22)"
          strokeWidth={2.2}
          markerEnd={`url(#arrow-${arrowId})`}
        />
      );
    }

    // Preview cable
    const c = connectDragRef.current;
    if (connectMode && c) {
      const a = map.get(c.fromId);
      if (a) {
        const x1 = a.ui.x + NODE_W;
        const y1 = a.ui.y + NODE_H / 2;
        const x2 = c.mouseWorld.x;
        const y2 = c.mouseWorld.y;
        const d = bezierPath(x1, y1, x2, y2);

        lines.push(
          <path
            key="__preview__"
            d={d}
            fill="none"
            stroke="rgba(99,102,241,0.55)"
            strokeWidth={2.6}
            strokeDasharray="6 6"
            markerEnd={`url(#arrow-${arrowId})`}
          />
        );
      }
    }

    return (
      <svg className="absolute inset-0 h-full w-full">
        <defs>
          <marker
            id={`arrow-${arrowId}`}
            markerWidth="12"
            markerHeight="12"
            refX="10"
            refY="6"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 12 6 L 0 12 z" fill="rgba(255,255,255,0.28)" />
          </marker>
        </defs>

        {/* todo el contenido se renderiza dentro de un <g> con la misma transform que los nodos */}
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>{lines}</g>
      </svg>
    );
  }, [nodes, edges, connectMode, view.x, view.y, view.scale, arrowId]);

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

  const connectHint = connectMode ? 'Modo conectar: arrastra desde el punto de salida al punto de entrada.' : null;

  // Grid style que se mueve con pan/zoom
  const gridSize = GRID_BASE * view.scale;
  const gridStyle: React.CSSProperties = {
    backgroundImage:
      'linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)',
    backgroundSize: `${gridSize}px ${gridSize}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };

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
              connectDragRef.current = null;
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
        {/* CANVAS */}
        <div className="card-glass relative h-[70vh] rounded-2xl border border-white/10 bg-black/20 backdrop-blur lg:col-span-2">
          {/* Top-left actions */}
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

          {/* Zoom controls */}
          <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
            <div className="rounded-xl border border-white/10 bg-black/30 p-1 backdrop-blur">
              <button
                type="button"
                onClick={() => zoomBy('out')}
                className="inline-flex items-center justify-center rounded-lg px-2 py-2 text-white/80 hover:bg-white/10"
                title="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => zoomBy('in')}
                className="inline-flex items-center justify-center rounded-lg px-2 py-2 text-white/80 hover:bg-white/10"
                title="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={resetView}
                className="inline-flex items-center justify-center rounded-lg px-2 py-2 text-white/80 hover:bg-white/10"
                title="Reset view"
              >
                <LocateFixed className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70">
              {Math.round(view.scale * 100)}%
            </div>
          </div>

          {/* Canvas surface */}
          <div
            ref={canvasRef}
            onClick={onCanvasClick}
            onWheel={onWheel}
            onMouseDown={startPan}
            className="absolute inset-0 overflow-hidden rounded-2xl"
            style={gridStyle}
          >
            {/* Edges */}
            {edgesSvg}

            {/* Nodes layer: same transform as edges */}
            <div
              className="absolute left-0 top-0 h-full w-full"
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                transformOrigin: '0 0',
              }}
            >
              {nodes.map((n) => {
                const isSelected = n.id === selectedNodeId;

                const isTrigger = n.type === 'trigger';
                const baseBg = isTrigger ? 'bg-indigo-500/12' : 'bg-white/6';
                const baseBorder = isTrigger ? 'border-indigo-400/20' : 'border-white/10';

                return (
                  <div
                    key={n.id}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onNodeClick(n.id);
                    }}
                    style={{ transform: `translate(${n.ui.x}px, ${n.ui.y}px)` }}
                    className={cx(
                      'absolute left-0 top-0',
                      'w-[190px] rounded-2xl border p-3 shadow-[0_10px_30px_rgba(0,0,0,0.35)]',
                      'backdrop-blur-[6px] transition',
                      baseBg,
                      baseBorder,
                      isSelected ? 'ring-2 ring-indigo-300/35 border-indigo-300/30' : 'hover:bg-white/10'
                    )}
                  >
                    {/* Input handle (izquierda) */}
                    <button
                      type="button"
                      title={connectMode ? 'Suelta aquí para conectar' : 'Entrada'}
                      onPointerUp={(ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        completeConnectTo(n.id);
                      }}
                      className={cx(
                        'absolute -left-2 top-1/2 -translate-y-1/2',
                        'h-4 w-4 rounded-full border',
                        connectMode ? 'border-indigo-300/60 bg-indigo-500/40' : 'border-white/20 bg-white/10'
                      )}
                    />

                    {/* Output handle (derecha) */}
                    <button
                      type="button"
                      title={connectMode ? 'Arrastra para conectar' : 'Salida'}
                      onPointerDown={(ev) => beginConnectFrom(n.id, ev)}
                      className={cx(
                        'absolute -right-2 top-1/2 -translate-y-1/2',
                        'h-4 w-4 rounded-full border',
                        connectMode ? 'border-indigo-300/60 bg-indigo-500/40' : 'border-white/20 bg-white/10'
                      )}
                    />

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

                    {/* mini hint */}
                    {connectMode ? (
                      <div className="mt-2 text-[11px] text-white/50">Conecta usando los puntos</div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Pan hint */}
            <div className="absolute bottom-3 left-3 z-10 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70 backdrop-blur">
              Pan: <span className="text-white/85">Space + arrastrar</span> · Zoom: <span className="text-white/85">rueda</span>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
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
                <TriggerEditor config={asTriggerConfig(selectedNode.config)} onChange={(next) => updateSelectedTriggerConfig(next)} />
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