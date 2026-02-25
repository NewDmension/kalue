// src/app/(private)/automations/workflows/[id]/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';
import { Plus, Save, Link2, X, ZoomIn, ZoomOut, LocateFixed, ChevronDown, Mail, MessageSquare } from 'lucide-react';

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

// ---- Tipos/config tipados (PASO 2) ----
type TriggerEvent = 'lead.stage_changed';
type TriggerConfig = { event: TriggerEvent; toStageId?: string };

// ActionKinds
type ActionKind = 'lead.add_label' | 'action.send_email' | 'action.send_sms';

type ActionAddLabelConfig = { action: 'lead.add_label'; label: string };

type ActionSendEmailConfig = {
  action: 'action.send_email';
  to: string; // e.g. {{lead.email}}
  subject: string;
  body: string; // html/markdown/plain (engine decide)
};

type ActionSendSmsConfig = {
  action: 'action.send_sms';
  to: string; // e.g. {{lead.phone}}
  body: string;
};

type ActionConfig = ActionAddLabelConfig | ActionSendEmailConfig | ActionSendSmsConfig;
type NodeConfig = TriggerConfig | ActionConfig;

type NodeVM = {
  id: string;
  type: 'trigger' | 'action' | string;
  name: string;
  config: NodeConfig;
  ui: NodeUI;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickString(v: unknown, key: string): string | null {
  if (!isRecord(v)) return null;
  const out = v[key];
  return typeof out === 'string' ? out : null;
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

type Viewport = { x: number; y: number; scale: number };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function buildNiceCurvePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const c = clamp(Math.abs(dx) * 0.55, 60, 320);
  const cx1 = x1 + c;
  const cy1 = y1;
  const cx2 = x2 - c;
  const cy2 = y2;
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

/** UI constants (keep ports aligned with visuals) */
const NODE_W = 250;
const NODE_PORT_SIZE = 12; // px
const NODE_PORT_HALF = NODE_PORT_SIZE / 2; // 6
const NODE_PORT_Y = 56; // px from top of card (visually centered)

function getPortWorld(n: NodeVM, side: 'left' | 'right'): { x: number; y: number } {
  const x = side === 'left' ? n.ui.x : n.ui.x + NODE_W;
  const y = n.ui.y + NODE_PORT_Y;
  return { x, y };
}

function isHTMLElement(v: unknown): v is HTMLElement {
  return typeof v === 'object' && v !== null && 'nodeType' in (v as Record<string, unknown>);
}

function closestData(el: HTMLElement, attr: string): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur) {
    if (cur.getAttribute(attr) !== null) return cur;
    cur = cur.parentElement;
  }
  return null;
}

/* ---------------- Normalizadores config ---------------- */

function asTriggerConfig(v: unknown): TriggerConfig {
  if (!isRecord(v)) return { event: 'lead.stage_changed' };
  const event: TriggerEvent = v.event === 'lead.stage_changed' ? 'lead.stage_changed' : 'lead.stage_changed';
  const toStageId = typeof v.toStageId === 'string' && v.toStageId.trim() ? v.toStageId.trim() : undefined;
  return { event, toStageId };
}

function defaultActionConfig(kind: ActionKind): ActionConfig {
  if (kind === 'lead.add_label') return { action: 'lead.add_label', label: '' };
  if (kind === 'action.send_email') return { action: 'action.send_email', to: '{{lead.email}}', subject: '', body: '' };
  return { action: 'action.send_sms', to: '{{lead.phone}}', body: '' };
}

function asActionConfig(v: unknown): ActionConfig {
  if (!isRecord(v)) return defaultActionConfig('lead.add_label');

  const action = pickString(v, 'action');

  if (action === 'lead.add_label') {
    const label = typeof v.label === 'string' ? v.label : '';
    return { action: 'lead.add_label', label };
  }

  if (action === 'action.send_email') {
    const to = typeof v.to === 'string' && v.to.trim() ? v.to : '{{lead.email}}';
    const subject = typeof v.subject === 'string' ? v.subject : '';
    const body = typeof v.body === 'string' ? v.body : '';
    return { action: 'action.send_email', to, subject, body };
  }

  if (action === 'action.send_sms') {
    const to = typeof v.to === 'string' && v.to.trim() ? v.to : '{{lead.phone}}';
    const body = typeof v.body === 'string' ? v.body : '';
    return { action: 'action.send_sms', to, body };
  }

  return defaultActionConfig('lead.add_label');
}

function nodeSubtitle(n: NodeVM): string {
  if (n.type === 'trigger') return 'trigger';
  if (n.type === 'action') {
    const c = n.config;
    if ('action' in c) return c.action;
    return 'action';
  }
  return n.type;
}

function actionLabel(kind: ActionKind): string {
  if (kind === 'lead.add_label') return 'Añadir etiqueta';
  if (kind === 'action.send_email') return 'Enviar Email';
  return 'Enviar SMS';
}

function actionIcon(kind: ActionKind): ReactElement {
  if (kind === 'action.send_email') return <Mail className="h-4 w-4" />;
  if (kind === 'action.send_sms') return <MessageSquare className="h-4 w-4" />;
  return <Plus className="h-4 w-4" />;
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

  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const [connectMode, setConnectMode] = useState(false);
  const [connectFromId, setConnectFromId] = useState<string | null>(null);

  // Pan/Zoom
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef<Viewport>({ x: 0, y: 0, scale: 1 });
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const isSpaceDownRef = useRef(false);
  const panningRef = useRef<{ startClientX: number; startClientY: number; startViewX: number; startViewY: number } | null>(null);

  const draggingNodeRef = useRef<{
    nodeId: string;
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);

  const [connectPreviewWorld, setConnectPreviewWorld] = useState<{ x: number; y: number } | null>(null);

  // Create Action dropdown (UI)
  const [actionMenuOpen, setActionMenuOpen] = useState(false);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId]);

  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return null;
    return edges.find((e) => e.id === selectedEdgeId) ?? null;
  }, [edges, selectedEdgeId]);

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
        const rawConfig: unknown = n.config;

        const normalizedConfig: NodeConfig =
          n.type === 'trigger'
            ? asTriggerConfig(rawConfig)
            : n.type === 'action'
              ? asActionConfig(rawConfig)
              : // fallback safe
                asActionConfig(rawConfig);

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

    // Center view around content on load
    queueMicrotask(() => {
      const rect = canvasRef.current?.getBoundingClientRect() ?? null;
      if (!rect) return;

      if (vmNodes.length === 0) {
        setView({ x: 0, y: 0, scale: 1 });
        return;
      }

      const xs = vmNodes.map((n) => n.ui.x);
      const ys = vmNodes.map((n) => n.ui.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs) + NODE_W + 120;
      const maxY = Math.max(...ys) + 180;

      const contentW = Math.max(1, maxX - minX);
      const contentH = Math.max(1, maxY - minY);

      const scale = clamp(Math.min(rect.width / contentW, rect.height / contentH) * 0.92, 0.6, 1.25);
      const x = rect.width / 2 - (minX + contentW / 2) * scale;
      const y = rect.height / 2 - (minY + contentH / 2) * scale;

      setView({ x, y, scale });
    });

    setLoading(false);
  }, [workflowId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Space helper
  useEffect(() => {
    const onDown = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') isSpaceDownRef.current = true;
    };
    const onUp = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') isSpaceDownRef.current = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // Global mouse move for node drag / pan
  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const d = draggingNodeRef.current;
      if (d) {
        ev.preventDefault();
        const dx = (ev.clientX - d.startMouseX) / viewRef.current.scale;
        const dy = (ev.clientY - d.startMouseY) / viewRef.current.scale;

        setNodes((prev) => prev.map((n) => (n.id === d.nodeId ? { ...n, ui: { x: d.startX + dx, y: d.startY + dy } } : n)));
        return;
      }

      const p = panningRef.current;
      if (p) {
        ev.preventDefault();
        const dx = ev.clientX - p.startClientX;
        const dy = ev.clientY - p.startClientY;
        setView((prev) => ({ ...prev, x: p.startViewX + dx, y: p.startViewY + dy }));
      }
    };

    const onUp = () => {
      draggingNodeRef.current = null;
      panningRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Delete edge with Delete/Backspace
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        if (selectedEdgeId) {
          ev.preventDefault();
          setEdges((prev) => prev.filter((e) => e.id !== selectedEdgeId));
          setSelectedEdgeId(null);
          setActionInfo('Conexión eliminada (no olvides Guardar).');
        }
      }
      if (ev.key === 'Escape') {
        setConnectFromId(null);
        setConnectMode(false);
        setConnectPreviewWorld(null);
        setActionMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedEdgeId]);

  const startDragNode = useCallback(
    (nodeId: string, ev: React.MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      const n = nodes.find((x) => x.id === nodeId);
      if (!n) return;

      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);

      draggingNodeRef.current = {
        nodeId,
        startMouseX: ev.clientX,
        startMouseY: ev.clientY,
        startX: n.ui.x,
        startY: n.ui.y,
      };
    },
    [nodes]
  );

  const clearSelections = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setActionInfo(null);
    setActionError(null);
    if (connectMode) setConnectFromId(null);
  }, [connectMode]);

  const onCanvasClick = useCallback(() => {
    clearSelections();
  }, [clearSelections]);

  const onNodeClick = useCallback(
    (nodeId: string) => {
      setActionError(null);
      setActionInfo(null);
      setSelectedEdgeId(null);

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
        setConnectPreviewWorld(null);
        return;
      }

      const id = uuidv4();
      setEdges((prev) => [...prev, { id, from_node_id: connectFromId, to_node_id: nodeId, condition_key: null }]);
      setConnectFromId(null);
      setConnectPreviewWorld(null);
      setSelectedNodeId(nodeId);
      setActionInfo('Conexión creada (no olvides Guardar).');
    },
    [connectMode, connectFromId, edges]
  );

  const createNode = useCallback(
    async (type: 'trigger' | 'action', actionKind?: ActionKind): Promise<void> => {
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

      // Create in viewport center (world coords)
      const v = viewRef.current;
      const cx0 = rect ? rect.width / 2 : 320;
      const cy0 = rect ? rect.height / 2 : 240;

      const worldX = (cx0 - v.x) / v.scale;
      const worldY = (cy0 - v.y) / v.scale;

      const x = Math.max(40, worldX - 90);
      const y = Math.max(40, worldY - 40);

      const initialConfig: NodeConfig =
        type === 'trigger'
          ? { event: 'lead.stage_changed' }
          : defaultActionConfig(actionKind ?? 'lead.add_label');

      const name =
        type === 'trigger'
          ? 'Trigger'
          : actionKind === 'action.send_email'
            ? 'Enviar Email'
            : actionKind === 'action.send_sms'
              ? 'Enviar SMS'
              : 'Acción';

      // Enviamos config también; si el backend lo ignora, no rompe.
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
          name,
          x,
          y,
          config: initialConfig,
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
      const nodeName = typeof nodeUnknown.name === 'string' ? nodeUnknown.name : name;

      if (!id) {
        // eslint-disable-next-line no-console
        console.error('node-create invalid node.id', nodeUnknown);
        setActionError('node_create_invalid_node_id');
        return;
      }

      const ui = parseNodeUi(nodeUnknown.ui);

      // Si backend no devuelve config, usamos el inicial
      const rawConfig: unknown = nodeUnknown.config ?? initialConfig;
      const normalizedConfig: NodeConfig =
        nodeType === 'trigger' ? asTriggerConfig(rawConfig) : nodeType === 'action' ? asActionConfig(rawConfig) : asActionConfig(rawConfig);

      const node: NodeVM = { id, type: nodeType, name: nodeName, config: normalizedConfig, ui };

      setNodes((prev) => [...prev, node]);
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
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

  const deleteSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) return;
    setEdges((prev) => prev.filter((e) => e.id !== selectedEdgeId));
    setSelectedEdgeId(null);
    setActionInfo('Conexión eliminada (no olvides Guardar).');
  }, [selectedEdgeId]);

  const updateSelectedTriggerConfig = useCallback(
    (next: TriggerConfig) => {
      setNodes((prev) => prev.map((n) => (n.id === selectedNodeId ? { ...n, config: next } : n)));
    },
    [selectedNodeId]
  );

  const updateSelectedActionConfig = useCallback(
    (next: ActionConfig) => {
      setNodes((prev) => prev.map((n) => (n.id === selectedNodeId ? { ...n, config: next } : n)));
    },
    [selectedNodeId]
  );

  const startPan = useCallback((ev: React.MouseEvent<HTMLDivElement>) => {
    const isMiddle = ev.button === 1;
    const isLeft = ev.button === 0;

    // Pan ONLY if clicking on background (not on node or toolbar overlay).
    const targetEl = isHTMLElement(ev.target) ? ev.target : null;
    const clickedNode = targetEl ? closestData(targetEl, 'data-node') : null;
    if (clickedNode) return;

    if (!(isMiddle || isSpaceDownRef.current || isLeft)) return;

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

  const onCanvasMouseMove = useCallback(
    (ev: React.MouseEvent<HTMLDivElement>) => {
      if (!connectMode || !connectFromId) return;
      const rect = canvasRef.current?.getBoundingClientRect() ?? null;
      if (!rect) return;

      const v = viewRef.current;
      const sx = ev.clientX - rect.left;
      const sy = ev.clientY - rect.top;

      const wx = (sx - v.x) / v.scale;
      const wy = (sy - v.y) / v.scale;

      setConnectPreviewWorld({ x: wx, y: wy });
    },
    [connectMode, connectFromId]
  );

  const onWheelZoom = useCallback((ev: React.WheelEvent<HTMLDivElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect() ?? null;
    if (!rect) return;

    const delta = ev.deltaY;
    const zoomFactor = delta > 0 ? 0.92 : 1.08;

    const prev = viewRef.current;
    const nextScale = clamp(prev.scale * zoomFactor, 0.35, 2.5);
    if (nextScale === prev.scale) return;

    ev.preventDefault();

    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;

    const wx = (sx - prev.x) / prev.scale;
    const wy = (sy - prev.y) / prev.scale;

    const nextX = sx - wx * nextScale;
    const nextY = sy - wy * nextScale;

    setView({ x: nextX, y: nextY, scale: nextScale });
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect() ?? null;
    const prev = viewRef.current;
    const nextScale = clamp(prev.scale * factor, 0.35, 2.5);

    if (!rect) {
      setView((p) => ({ ...p, scale: nextScale }));
      return;
    }

    const sx = rect.width / 2;
    const sy = rect.height / 2;

    const wx = (sx - prev.x) / prev.scale;
    const wy = (sy - prev.y) / prev.scale;

    const nextX = sx - wx * nextScale;
    const nextY = sy - wy * nextScale;

    setView({ x: nextX, y: nextY, scale: nextScale });
  }, []);

  const centerGraph = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect() ?? null;
    if (!rect) return;

    if (nodes.length === 0) {
      setView({ x: 0, y: 0, scale: 1 });
      return;
    }

    const xs = nodes.map((n) => n.ui.x);
    const ys = nodes.map((n) => n.ui.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs) + NODE_W + 120;
    const maxY = Math.max(...ys) + 180;

    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);

    const scale = clamp(Math.min(rect.width / contentW, rect.height / contentH) * 0.92, 0.6, 1.25);
    const x = rect.width / 2 - (minX + contentW / 2) * scale;
    const y = rect.height / 2 - (minY + contentH / 2) * scale;

    setView({ x, y, scale });
  }, [nodes]);

  const edgesSvg = useMemo((): ReactElement[] => {
    const map = new Map<string, NodeVM>();
    for (const n of nodes) map.set(n.id, n);

    const out: ReactElement[] = [];

    for (const e of edges) {
      const a = map.get(e.from_node_id);
      const b = map.get(e.to_node_id);
      if (!a || !b) continue;

      const p1 = getPortWorld(a, 'right');
      const p2 = getPortWorld(b, 'left');

      const x1 = p1.x + 2;
      const y1 = p1.y;
      const x2 = p2.x - 2;
      const y2 = p2.y;

      const d = buildNiceCurvePath(x1, y1, x2, y2);
      const isSelected = selectedEdgeId === e.id;

      out.push(
        <path
          key={`${e.id}__hit`}
          d={d}
          fill="none"
          stroke="rgba(0,0,0,0)"
          strokeWidth={14}
          style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
          onClick={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setSelectedEdgeId(e.id);
            setSelectedNodeId(null);
            setActionInfo(null);
            setActionError(null);
          }}
        />
      );

      out.push(
        <path
          key={e.id}
          d={d}
          fill="none"
          stroke={isSelected ? 'rgba(99,102,241,0.55)' : 'rgba(255,255,255,0.18)'}
          strokeWidth={isSelected ? 2.0 : 1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none' }}
        />
      );
    }

    // Preview
    if (connectMode && connectFromId && connectPreviewWorld) {
      const a = map.get(connectFromId);
      if (a) {
        const p1 = getPortWorld(a, 'right');
        const x1 = p1.x + 2;
        const y1 = p1.y;
        const x2 = connectPreviewWorld.x;
        const y2 = connectPreviewWorld.y;

        const d = buildNiceCurvePath(x1, y1, x2, y2);

        out.push(
          <path
            key="__preview__"
            d={d}
            fill="none"
            stroke="rgba(99,102,241,0.55)"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeDasharray="6 6"
            style={{ pointerEvents: 'none' }}
          />
        );
      }
    }

    return out;
  }, [nodes, edges, selectedEdgeId, connectMode, connectFromId, connectPreviewWorld]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="card-glass rounded-2xl border border-white/10 bg-black/20 p-6 backdrop-blur">Cargando workflow…</div>
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

  const worldTransformStyle: React.CSSProperties = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transformOrigin: '0 0',
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
              setConnectFromId(null);
              setConnectPreviewWorld(null);
              setActionMenuOpen(false);
            }}
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

      {actionError ? (
        <div className="mb-3 card-glass rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-white/80">{actionError}</div>
      ) : null}

      {actionInfo ? (
        <div className="mb-3 card-glass rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-white/75">{actionInfo}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card-glass relative h-[70vh] rounded-2xl border border-white/10 bg-black/20 backdrop-blur lg:col-span-2">
          {/* Toolbar left */}
          <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void createNode('trigger')}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-indigo-500/20 px-3 py-2 text-sm text-white hover:bg-indigo-500/30"
            >
              <Plus className="h-4 w-4" />
              Trigger
            </button>

            {/* Action dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setActionMenuOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 hover:bg-white/10"
              >
                <Plus className="h-4 w-4" />
                Acción
                <ChevronDown className="h-4 w-4 opacity-70" />
              </button>

              {actionMenuOpen ? (
                <div className="absolute left-0 mt-2 w-64 rounded-2xl border border-white/10 bg-black/60 p-2 backdrop-blur">
                  {(['lead.add_label', 'action.send_email', 'action.send_sms'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setActionMenuOpen(false);
                        void createNode('action', k);
                      }}
                      className="flex w-full items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-left text-sm text-white/85 hover:border-white/10 hover:bg-white/10"
                    >
                      {actionIcon(k)}
                      {actionLabel(k)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {/* Toolbar right */}
          <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
            <button
              type="button"
              onClick={() => zoomBy(1.12)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 hover:bg-white/10"
              title="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => zoomBy(1 / 1.12)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 hover:bg-white/10"
              title="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={centerGraph}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 hover:bg-white/10"
              title="Centrar"
            >
              <LocateFixed className="h-4 w-4" />
            </button>
          </div>

          {/* Canvas */}
          <div
            ref={canvasRef}
            onClick={onCanvasClick}
            onMouseDown={startPan}
            onMouseMove={onCanvasMouseMove}
            onWheel={onWheelZoom}
            className={cx('absolute inset-0 overflow-hidden rounded-2xl', 'cursor-grab active:cursor-grabbing', 'bg-black/10')}
          >
            {/* World layer */}
            <div className="absolute inset-0" style={worldTransformStyle}>
              {/* Dotted background */}
              <div
                className="absolute"
                style={{
                  left: -4000,
                  top: -4000,
                  width: 8000,
                  height: 8000,
                  backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.10) 1px, transparent 0)',
                  backgroundSize: '26px 26px',
                  opacity: 0.55,
                }}
              />
              {/* Vignette */}
              <div
                className="pointer-events-none absolute"
                style={{
                  left: -4000,
                  top: -4000,
                  width: 8000,
                  height: 8000,
                  background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.75) 100%)',
                }}
              />

              {/* SVG edges */}
              <svg className="absolute inset-0 h-full w-full" style={{ overflow: 'visible' }}>
                {edgesSvg}
              </svg>

              {/* Nodes */}
              {nodes.map((n) => {
                const isSelected = n.id === selectedNodeId;
                const isConnectFrom = connectMode && connectFromId === n.id;

                return (
                  <div
                    key={n.id}
                    data-node=""
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onNodeClick(n.id);
                    }}
                    style={{ transform: `translate(${n.ui.x}px, ${n.ui.y}px)` }}
                    className={cx(
                      'absolute left-0 top-0 w-[250px] cursor-default select-none rounded-2xl border p-4 shadow-sm transition',
                      isSelected ? 'border-indigo-400/35 bg-indigo-500/15' : 'border-white/10 bg-white/5 hover:bg-white/10',
                      isConnectFrom ? 'ring-2 ring-indigo-300/50' : null
                    )}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold text-white/90">{n.name}</div>
                        <div className="text-[12px] text-white/50">{nodeSubtitle(n)}</div>
                      </div>

                      <button
                        type="button"
                        onMouseDown={(ev) => startDragNode(n.id, ev)}
                        className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] text-white/70 hover:bg-white/10"
                        title="Arrastrar"
                      >
                        ⋮⋮
                      </button>
                    </div>

                    {/* Ports */}
                    <div
                      className="pointer-events-none absolute rounded-full border border-white/10 bg-white/5"
                      style={{
                        width: NODE_PORT_SIZE,
                        height: NODE_PORT_SIZE,
                        left: -NODE_PORT_HALF,
                        top: NODE_PORT_Y - NODE_PORT_HALF,
                      }}
                    />
                    <div
                      className="pointer-events-none absolute rounded-full border border-white/10 bg-white/5"
                      style={{
                        width: NODE_PORT_SIZE,
                        height: NODE_PORT_SIZE,
                        left: NODE_W - NODE_PORT_HALF,
                        top: NODE_PORT_Y - NODE_PORT_HALF,
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Hint overlay */}
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-white/70">
              Arrastra el fondo para mover · Rueda para zoom · Click en cable para seleccionar · (Delete) borra cable
            </div>
          </div>
        </div>

        {/* Right panel */}
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
            ) : selectedEdge ? (
              <button
                type="button"
                onClick={deleteSelectedEdge}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                title="Quitar conexión"
              >
                <X className="h-4 w-4" />
                Eliminar
              </button>
            ) : null}
          </div>

          {selectedEdge ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-sm font-medium text-white/85">Conexión</div>
              <div className="mt-2 text-xs text-white/60">
                {selectedEdge.from_node_id} → {selectedEdge.to_node_id}
              </div>
              <div className="mt-2 text-[11px] text-white/55">Pulsa Guardar para persistir.</div>
            </div>
          ) : null}

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
                <div className="mt-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">{selectedNode.type}</div>
              </div>

              {selectedNode.type === 'trigger' ? (
                <TriggerEditor config={asTriggerConfig(selectedNode.config)} onChange={(next) => updateSelectedTriggerConfig(next)} />
              ) : null}

              {selectedNode.type === 'action' ? (
                <ActionEditor config={asActionConfig(selectedNode.config)} onChange={(next) => updateSelectedActionConfig(next)} />
              ) : null}

              <div className="text-xs text-white/55">
                Recuerda pulsar <span className="text-white/75">Guardar</span> para persistir cambios.
              </div>
            </div>
          ) : !selectedEdge ? (
            <div className="mt-4 text-sm text-white/60">Selecciona un nodo (o una conexión) para editar.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------ Editors ------------------ */

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

function ActionEditor(props: { config: ActionConfig; onChange: (next: ActionConfig) => void }) {
  const c = props.config;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="text-sm font-medium text-white/85">Acción</div>

      <div className="mt-3">
        <label className="text-xs text-white/60">Tipo</label>
        <select
          value={c.action}
          onChange={(e) => {
            const next = e.target.value as ActionKind;
            props.onChange(defaultActionConfig(next));
          }}
          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/40"
        >
          <option value="lead.add_label">Añadir etiqueta (label)</option>
          <option value="action.send_email">Enviar Email</option>
          <option value="action.send_sms">Enviar SMS</option>
        </select>
      </div>

      {c.action === 'lead.add_label' ? <ActionAddLabelFields config={c} onChange={props.onChange} /> : null}
      {c.action === 'action.send_email' ? <ActionSendEmailFields config={c} onChange={props.onChange} /> : null}
      {c.action === 'action.send_sms' ? <ActionSendSmsFields config={c} onChange={props.onChange} /> : null}
    </div>
  );
}

function ActionAddLabelFields(props: { config: ActionAddLabelConfig; onChange: (next: ActionConfig) => void }) {
  return (
    <div className="mt-3">
      <label className="text-xs text-white/60">Label</label>
      <input
        value={props.config.label}
        onChange={(e) => props.onChange({ ...props.config, label: e.target.value })}
        placeholder="Ej: Movido a Contactado"
        className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/40"
      />
    </div>
  );
}

function ActionSendEmailFields(props: { config: ActionSendEmailConfig; onChange: (next: ActionConfig) => void }) {
  return (
    <div className="mt-3 space-y-3">
      <div className="text-[11px] text-white/55">Tip: usa variables como {'{{lead.email}}'} o {'{{lead.first_name}}'}.</div>

      <div>
        <label className="text-xs text-white/60">To</label>
        <input
          value={props.config.to}
          onChange={(e) => props.onChange({ ...props.config, to: e.target.value })}
          placeholder="{{lead.email}}"
          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/40"
        />
      </div>

      <div>
        <label className="text-xs text-white/60">Subject</label>
        <input
          value={props.config.subject}
          onChange={(e) => props.onChange({ ...props.config, subject: e.target.value })}
          placeholder="Asunto del email"
          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/40"
        />
      </div>

      <div>
        <label className="text-xs text-white/60">Body</label>
        <textarea
          value={props.config.body}
          onChange={(e) => props.onChange({ ...props.config, body: e.target.value })}
          placeholder="Hola {{lead.first_name}}, …"
          rows={8}
          className="mt-1 w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/40"
        />
      </div>
    </div>
  );
}

function ActionSendSmsFields(props: { config: ActionSendSmsConfig; onChange: (next: ActionConfig) => void }) {
  return (
    <div className="mt-3 space-y-3">
      <div className="text-[11px] text-white/55">Tip: SMS recomendado 160–300 caracteres. Variables: {'{{lead.phone}}'}.</div>

      <div>
        <label className="text-xs text-white/60">To</label>
        <input
          value={props.config.to}
          onChange={(e) => props.onChange({ ...props.config, to: e.target.value })}
          placeholder="{{lead.phone}}"
          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/40"
        />
      </div>

      <div>
        <label className="text-xs text-white/60">Body</label>
        <textarea
          value={props.config.body}
          onChange={(e) => props.onChange({ ...props.config, body: e.target.value })}
          placeholder="Hola {{lead.first_name}}…"
          rows={6}
          className="mt-1 w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/40"
        />
      </div>
    </div>
  );
}