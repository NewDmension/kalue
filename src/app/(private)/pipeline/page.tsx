// src/app/(private)/pipeline/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useWorkspace } from '@/components/app/WorkspaceContext';
import { GripVertical, X, Copy } from 'lucide-react';

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
  stage_id: string;
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

type StageCreateResponse =
  | { ok: true; stage: StageRow }
  | { ok: false; error: string; detail?: string };

type StageRenameResponse =
  | { ok: true; stage: StageRow }
  | { ok: false; error: string; detail?: string };

type StageDeleteResponse =
  | { ok: true }
  | { ok: false; error: string; detail?: string };

type DragPayload = {
  leadId: string;
  fromStageId: string;
  pipelineId: string;
};

type StageDragPayload = {
  stageId: string;
  pipelineId: string;
};

type StageReorderResponse =
  | { ok: true }
  | { ok: false; error: string; detail?: string };

const DND_KEY_LEAD = 'application/x-kalue-lead';
const DND_KEY_STAGE = 'application/x-kalue-stage';

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

function safeParseStageDragPayload(raw: string): StageDragPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const r = parsed as Record<string, unknown>;
    const stageId = typeof r.stageId === 'string' ? r.stageId : '';
    const pipelineId = typeof r.pipelineId === 'string' ? r.pipelineId : '';
    if (!stageId || !pipelineId) return null;
    return { stageId, pipelineId };
  } catch {
    return null;
  }
}

function formatLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', 'true');
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

function cloneLeadsByStage(src: Record<string, LeadRow[]>): Record<string, LeadRow[]> {
  // structuredClone es ideal en navegadores modernos; fallback seguro
  try {
    return structuredClone(src);
  } catch {
    return JSON.parse(JSON.stringify(src)) as Record<string, LeadRow[]>;
  }
}

function hasType(e: DragEvent, type: string): boolean {
  const types = Array.from(e.dataTransfer.types);
  return types.includes(type);
}

export default function PipelinePage() {
  const { activeWorkspaceId } = useWorkspace();

  const [error, setError] = useState<string | null>(null);

  // Selección + drag “aura”
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);
  const [draggingStageId, setDraggingStageId] = useState<string | null>(null);
  const [dragOverStageIndex, setDragOverStageIndex] = useState<number | null>(null);

  // gap hover para insertar leads por índice
  const [dragOverLead, setDragOverLead] = useState<{ stageId: string; index: number } | null>(null);

  // Pipelines
  const [pipelinesLoading, setPipelinesLoading] = useState(true);
  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);

  // Create pipeline
  const [newPipelineName, setNewPipelineName] = useState('');
  const [creatingPipeline, setCreatingPipeline] = useState(false);

  // Board
  const [boardLoading, setBoardLoading] = useState(false);
  const [stages, setStages] = useState<StageRow[]>([]);
  const [leadsByStage, setLeadsByStage] = useState<Record<string, LeadRow[]>>({});

  // Stage CRUD UI
  const [newStageName, setNewStageName] = useState('');
  const [creatingStage, setCreatingStage] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameStageId, setRenameStageId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteStageId, setDeleteStageId] = useState<string | null>(null);
  const [deleteToStageId, setDeleteToStageId] = useState<string>('');
  const [deleting, setDeleting] = useState(false);

  // ✅ Anti doble-drop + anti race (muy importante)
  const dropHandledRef = useRef(false);
  const pendingMoveIdRef = useRef<string | null>(null);

  function nextMoveId(): string {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function markDropHandledThisTick(): boolean {
    if (dropHandledRef.current) return true;
    dropHandledRef.current = true;
    queueMicrotask(() => {
      dropHandledRef.current = false;
    });
    return false;
  }

  const selectedPipeline = useMemo(() => {
    if (!selectedPipelineId) return null;
    return pipelines.find((p) => p.id === selectedPipelineId) ?? null;
  }, [pipelines, selectedPipelineId]);

  const stagesById = useMemo(() => {
    const m = new Map<string, StageRow>();
    for (const s of stages) m.set(s.id, s);
    return m;
  }, [stages]);

  const stageNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stages) m.set(s.id, s.name);
    return m;
  }, [stages]);

  const selectedLead = useMemo(() => {
    if (!selectedLeadId) return null;
    for (const arr of Object.values(leadsByStage)) {
      const found = arr.find((l) => l.id === selectedLeadId);
      if (found) return found;
    }
    return null;
  }, [leadsByStage, selectedLeadId]);

  const selectedLeadStageName = useMemo(() => {
    if (!selectedLead) return null;
    return stageNameById.get(selectedLead.stage_id) ?? null;
  }, [selectedLead, stageNameById]);

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
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': activeWorkspaceId },
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

    const name = newPipelineName.trim();
    if (!name) return;

    setCreatingPipeline(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setError('login_required');
      setCreatingPipeline(false);
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
      setCreatingPipeline(false);
      return;
    }

    const r = raw as Record<string, unknown>;
    if (r.ok !== true) {
      const msg = typeof r.error === 'string' ? r.error : 'create_failed';
      const detail = typeof r.detail === 'string' ? r.detail : '';
      setError(detail ? `${msg}: ${detail}` : msg);
      setCreatingPipeline(false);
      return;
    }

    const pipeline = r.pipeline as unknown as PipelineRow | undefined;
    const pipelineId = typeof r.pipelineId === 'string' ? r.pipelineId : null;

    if (!pipeline || !pipelineId) {
      setError('create_failed: bad_return');
      setCreatingPipeline(false);
      return;
    }

    setNewPipelineName('');
    setPipelines((prev) => [pipeline, ...prev]);
    setSelectedPipelineId(pipelineId);
    setCreatingPipeline(false);
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
      headers: { authorization: `Bearer ${token}`, 'x-workspace-id': activeWorkspaceId },
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

  // ✅ mover o reordenar lead por índice (mismo stage o stage distinto) — FIXED
  function optimisticUpsertLead(args: {
    leadId: string;
    fromStageId: string;
    toStageId: string;
    toIndex: number;
  }): void {
    setLeadsByStage((prev) => {
      const next: Record<string, LeadRow[]> = { ...prev };

      const fromArr = Array.isArray(next[args.fromStageId]) ? [...next[args.fromStageId]!] : [];
      const sameStage = args.fromStageId === args.toStageId;
      const toArr = sameStage
        ? fromArr
        : Array.isArray(next[args.toStageId])
          ? [...next[args.toStageId]!]
          : [];

      const fromIndex = fromArr.findIndex((l) => l.id === args.leadId);
      if (fromIndex < 0) return prev;

      const lead = fromArr[fromIndex]!;
      fromArr.splice(fromIndex, 1);

      // ✅ Ajuste CLAVE: si es el mismo stage y mueves hacia abajo, el índice real baja 1
      let insertIndex = args.toIndex;
      if (sameStage && fromIndex < insertIndex) insertIndex = insertIndex - 1;

      // bound
      insertIndex = Math.max(0, Math.min(insertIndex, toArr.length));

      const moved: LeadRow = {
        ...lead,
        stage_id: args.toStageId,
        stage_changed_at: new Date().toISOString(),
        position: insertIndex,
      };

      toArr.splice(insertIndex, 0, moved);

      // Normaliza posiciones para evitar renders raros
      const normalizedTo = toArr.map((l, idx) => ({ ...l, position: idx }));
      const normalizedFrom = fromArr.map((l, idx) => ({ ...l, position: idx }));

      next[args.toStageId] = normalizedTo;
      if (!sameStage) next[args.fromStageId] = normalizedFrom;
      else next[args.fromStageId] = normalizedTo;

      return next;
    });
  }

  // ✅ persistMoveLead con razón mínima (para saber si estás revirtiendo por ok=false)
  async function persistMoveLead(args: {
    leadId: string;
    toStageId: string;
    pipelineId: string;
    toPosition: number;
    moveId: string;
  }): Promise<{ ok: boolean; reason?: string }> {
    if (!activeWorkspaceId) return { ok: false, reason: 'no_workspace' };

    const token = await getAccessToken();
    if (!token) {
      setError('login_required');
      return { ok: false, reason: 'no_token' };
    }

    try {
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
          clientMoveId: args.moveId,
        }),
      });

      const raw = (await res.json().catch(() => null)) as unknown;

      // shape esperado: { ok: true } | { ok:false, error?, detail? }
      const parsed = raw as MoveLeadResponse | null;

      if (!res.ok || !parsed || parsed.ok !== true) {
        const err = parsed && parsed.ok === false ? parsed.error : undefined;
        const det = parsed && parsed.ok === false ? parsed.detail : undefined;
        const reason = err ? (det ? `${err}: ${det}` : err) : `http_${res.status}`;
        return { ok: false, reason };
      }

      return { ok: true };
    } catch {
      return { ok: false, reason: 'network_error' };
    }
  }

  async function persistReorderStages(args: { pipelineId: string; stageIds: string[] }): Promise<boolean> {
    if (!activeWorkspaceId) return false;

    const token = await getAccessToken();
    if (!token) {
      setError('login_required');
      return false;
    }

    const res = await fetch('/api/pipelines/stages/reorder', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': activeWorkspaceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ pipelineId: args.pipelineId, stageIds: args.stageIds }),
    });

    const raw = (await res.json()) as unknown;
    const parsed = raw as StageReorderResponse;

    if (!res.ok || !parsed || parsed.ok !== true) {
      const msg =
        typeof (parsed as { error?: string }).error === 'string'
          ? (parsed as { error: string }).error
          : 'reorder_failed';
      const detail =
        typeof (parsed as { detail?: string }).detail === 'string'
          ? (parsed as { detail: string }).detail
          : '';
      setError(detail ? `${msg}: ${detail}` : msg);
      return false;
    }

    return true;
  }

  async function createStage(): Promise<void> {
    if (!activeWorkspaceId || !selectedPipelineId) return;

    const name = newStageName.trim();
    if (!name) return;

    setCreatingStage(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setError('login_required');
      setCreatingStage(false);
      return;
    }

    const res = await fetch('/api/pipelines/stages/create', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': activeWorkspaceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ pipelineId: selectedPipelineId, name }),
    });

    const raw = (await res.json()) as unknown;
    const parsed = raw as StageCreateResponse;

    if (!res.ok || !parsed || parsed.ok !== true) {
      const msg =
        typeof (parsed as { error?: string }).error === 'string'
          ? (parsed as { error: string }).error
          : 'create_stage_failed';
      const detail =
        typeof (parsed as { detail?: string }).detail === 'string'
          ? (parsed as { detail: string }).detail
          : '';
      setError(detail ? `${msg}: ${detail}` : msg);
      setCreatingStage(false);
      return;
    }

    setNewStageName('');
    await loadBoard(selectedPipelineId);
    setCreatingStage(false);
  }

  function openRename(stageId: string): void {
    const st = stagesById.get(stageId);
    if (!st) return;
    setRenameStageId(stageId);
    setRenameValue(st.name);
    setRenameOpen(true);
  }

  async function doRename(): Promise<void> {
    if (!activeWorkspaceId || !renameStageId) return;

    const name = renameValue.trim();
    if (!name) return;

    setRenaming(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setError('login_required');
      setRenaming(false);
      return;
    }

    const res = await fetch('/api/pipelines/stages/rename', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': activeWorkspaceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ stageId: renameStageId, name }),
    });

    const raw = (await res.json()) as unknown;
    const parsed = raw as StageRenameResponse;

    if (!res.ok || !parsed || parsed.ok !== true) {
      const msg =
        typeof (parsed as { error?: string }).error === 'string'
          ? (parsed as { error: string }).error
          : 'rename_failed';
      const detail =
        typeof (parsed as { detail?: string }).detail === 'string'
          ? (parsed as { detail: string }).detail
          : '';
      setError(detail ? `${msg}: ${detail}` : msg);
      setRenaming(false);
      return;
    }

    const updated = parsed.stage;
    setStages((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));

    setRenameOpen(false);
    setRenameStageId(null);
    setRenameValue('');
    setRenaming(false);
  }

  function openDelete(stageId: string): void {
    if (!selectedPipelineId) return;
    if (stages.length <= 1) {
      setError('No puedes borrar la única columna.');
      return;
    }

    const alternatives = stages.filter((s) => s.id !== stageId);
    const fallback = alternatives[0]?.id ?? '';
    setDeleteStageId(stageId);
    setDeleteToStageId(fallback);
    setDeleteOpen(true);
  }

  async function doDelete(): Promise<void> {
    if (!activeWorkspaceId || !selectedPipelineId) return;
    if (!deleteStageId) return;
    if (!deleteToStageId) return;

    setDeleting(true);
    setError(null);

    const token = await getAccessToken();
    if (!token) {
      setError('login_required');
      setDeleting(false);
      return;
    }

    const res = await fetch('/api/pipelines/stages/delete', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': activeWorkspaceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ stageId: deleteStageId, toStageId: deleteToStageId }),
    });

    const raw = (await res.json()) as unknown;
    const parsed = raw as StageDeleteResponse;

    if (!res.ok || !parsed || parsed.ok !== true) {
      const msg =
        typeof (parsed as { error?: string }).error === 'string'
          ? (parsed as { error: string }).error
          : 'delete_failed';
      const detail =
        typeof (parsed as { detail?: string }).detail === 'string'
          ? (parsed as { detail: string }).detail
          : '';
      setError(detail ? `${msg}: ${detail}` : msg);
      setDeleting(false);
      return;
    }

    setDeleteOpen(false);
    setDeleteStageId(null);
    setDeleteToStageId('');
    await loadBoard(selectedPipelineId);
    setDeleting(false);
  }

  // Load pipelines on workspace change
  useEffect(() => {
    void loadPipelines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  // Load board when pipeline selected
  useEffect(() => {
    setSelectedLeadId(null);
    if (!selectedPipelineId || !activeWorkspaceId) {
      setStages([]);
      setLeadsByStage({});
      return;
    }
    void loadBoard(selectedPipelineId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPipelineId, activeWorkspaceId]);

  // Drag handlers (STAGES)
  function onDragStartStage(e: DragEvent, payload: StageDragPayload): void {
    setDraggingStageId(payload.stageId);

    const data = safeJsonStringify(payload);
    e.dataTransfer.setData('text/plain', data);
    e.dataTransfer.setData(DND_KEY_STAGE, data);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragEndStage(): void {
    setDraggingStageId(null);
    setDragOverStageIndex(null);
  }

  // Drag handlers (LEADS)
  function onDragStartLead(e: DragEvent, payload: DragPayload): void {
    setDraggingLeadId(payload.leadId);

    const data = safeJsonStringify(payload);
    e.dataTransfer.setData('text/plain', data);
    e.dataTransfer.setData(DND_KEY_LEAD, data);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragEndLead(): void {
    setDraggingLeadId(null);
    setDragOverLead(null);
    dropHandledRef.current = false; // reset duro por seguridad
  }

  function onDragOverColumn(e: DragEvent): void {
    if (!hasType(e, DND_KEY_LEAD)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  }

  // gaps para insertar leads
  function onDragOverLeadGap(e: DragEvent, stageId: string, index: number): void {
    if (!hasType(e, DND_KEY_LEAD)) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverLead({ stageId, index });
  }

  function onDragLeaveLeadGap(): void {
    setDragOverLead(null);
  }

  async function onDropLeadGap(e: DragEvent, toStageId: string, toIndex: number): Promise<void> {
    if (!hasType(e, DND_KEY_LEAD)) return;

    e.preventDefault();
    e.stopPropagation();

    // ✅ evita doble drop
    if (markDropHandledThisTick()) return;

    const raw = e.dataTransfer.getData(DND_KEY_LEAD) || e.dataTransfer.getData('text/plain');
    const payload = safeParseDragPayload(raw);
    if (!payload) return;
    if (!selectedPipelineId) return;
    if (payload.pipelineId !== selectedPipelineId) return;

    const moveId = nextMoveId();
    pendingMoveIdRef.current = moveId;

    const snapshot = cloneLeadsByStage(leadsByStage);

    optimisticUpsertLead({
      leadId: payload.leadId,
      fromStageId: payload.fromStageId,
      toStageId,
      toIndex,
    });

    const result = await persistMoveLead({
      leadId: payload.leadId,
      pipelineId: payload.pipelineId,
      toStageId,
      toPosition: toIndex,
      moveId,
    });

    // ✅ si hubo otro move después, ignora este resultado
    if (pendingMoveIdRef.current !== moveId) return;

    if (!result.ok) {
      setLeadsByStage(snapshot);
      if (result.reason) setError(`move_lead_failed: ${result.reason}`);
    }

    setDragOverLead(null);
    setDraggingLeadId(null);
  }

  // Stage gaps
  function onDragOverStageGap(e: DragEvent, index: number): void {
    if (!hasType(e, DND_KEY_STAGE)) return;

    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStageIndex(index);
  }

  async function onDropStageGap(e: DragEvent, targetIndex: number): Promise<void> {
    if (!hasType(e, DND_KEY_STAGE)) return;

    e.preventDefault();
    e.stopPropagation();

    const raw = e.dataTransfer.getData(DND_KEY_STAGE) || e.dataTransfer.getData('text/plain');
    const payload = safeParseStageDragPayload(raw);
    if (!payload) return;

    if (!selectedPipelineId) return;
    if (payload.pipelineId !== selectedPipelineId) return;

    const current = [...stages];
    const fromIndex = current.findIndex((s) => s.id === payload.stageId);
    if (fromIndex < 0) return;

    if (fromIndex === targetIndex || fromIndex + 1 === targetIndex) {
      setDragOverStageIndex(null);
      setDraggingStageId(null);
      return;
    }

    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;

    const insertIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
    next.splice(insertIndex, 0, moved);

    setStages(next);

    const stageIds = next.map((s) => s.id);
    const ok = await persistReorderStages({ pipelineId: selectedPipelineId, stageIds });

    if (!ok) {
      await loadBoard(selectedPipelineId);
    }

    setDragOverStageIndex(null);
    setDraggingStageId(null);
  }

  async function onDropColumn(e: DragEvent, toStageId: string): Promise<void> {
    if (!hasType(e, DND_KEY_LEAD)) return;

    e.preventDefault();
    e.stopPropagation();

    // ✅ evita doble drop (si ya lo manejó un gap)
    if (markDropHandledThisTick()) return;

    const raw = e.dataTransfer.getData(DND_KEY_LEAD) || e.dataTransfer.getData('text/plain');
    const payload = safeParseDragPayload(raw);
    if (!payload) return;

    if (!selectedPipelineId) return;
    if (payload.pipelineId !== selectedPipelineId) return;

    const items = Array.isArray(leadsByStage[toStageId]) ? leadsByStage[toStageId]! : [];
    const toIndex = items.length;

    const moveId = nextMoveId();
    pendingMoveIdRef.current = moveId;

    const snapshot = cloneLeadsByStage(leadsByStage);

    optimisticUpsertLead({
      leadId: payload.leadId,
      fromStageId: payload.fromStageId,
      toStageId,
      toIndex,
    });

    const result = await persistMoveLead({
      leadId: payload.leadId,
      pipelineId: payload.pipelineId,
      toStageId,
      toPosition: toIndex,
      moveId,
    });

    if (pendingMoveIdRef.current !== moveId) return;

    if (!result.ok) {
      setLeadsByStage(snapshot);
      if (result.reason) setError(`move_lead_failed: ${result.reason}`);
    }

    setDragOverLead(null);
    setDraggingLeadId(null);
  }

  const boardHasStages = stages.length > 0;
  const canCreateStage = Boolean(activeWorkspaceId && selectedPipelineId);
  const canCreatePipeline = Boolean(activeWorkspaceId);

  const rightPanelOpen = Boolean(selectedLead);

  return (
    <div className="card-glass border border-white/10 rounded-2xl p-6 text-white">
      {/* HEADER */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Pipeline</h1>
            <p className="mt-1 text-sm text-white/70">Kanban por stages. Arrastra leads entre columnas.</p>
          </div>

          {/* TOOLBAR fila 1 */}
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
            {/* Selector pipeline */}
            <div className="flex w-full items-center gap-2 md:w-auto">
              <span className="shrink-0 text-xs text-white/55">Pipeline</span>
              <select
                value={selectedPipelineId ?? ''}
                onChange={(e) => setSelectedPipelineId(e.target.value || null)}
                className="w-full md:w-[260px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/30"
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

            {/* Crear pipeline */}
            <div className="flex w-full items-center gap-2 md:w-auto">
              <input
                value={newPipelineName}
                onChange={(e) => setNewPipelineName(e.target.value)}
                placeholder="Nuevo pipeline"
                className="w-full md:w-[220px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-indigo-400/30"
              />
              <button
                type="button"
                onClick={() => void createPipeline()}
                disabled={creatingPipeline || newPipelineName.trim().length === 0 || !canCreatePipeline}
                className={cx(
                  'shrink-0 rounded-xl border px-4 py-2 text-sm',
                  creatingPipeline || newPipelineName.trim().length === 0 || !canCreatePipeline
                    ? 'border-white/10 bg-white/5 text-white/40'
                    : 'border-indigo-400/25 bg-indigo-500/10 text-white hover:bg-indigo-500/15'
                )}
              >
                {creatingPipeline ? 'Creando…' : 'Crear'}
              </button>
            </div>
          </div>
        </div>

        {/* TOOLBAR fila 2: crear columna */}
        <div className="flex w-full flex-col gap-2 md:flex-row md:items-center md:justify-end">
          <div className="flex w-full items-center gap-2 md:w-auto">
            <input
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              placeholder="Nueva columna"
              className="w-full md:w-[260px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-emerald-400/30"
              disabled={!canCreateStage}
            />
            <button
              type="button"
              onClick={() => void createStage()}
              disabled={creatingStage || newStageName.trim().length === 0 || !canCreateStage}
              className={cx(
                'shrink-0 rounded-xl border px-4 py-2 text-sm',
                creatingStage || newStageName.trim().length === 0 || !canCreateStage
                  ? 'border-white/10 bg-white/5 text-white/40'
                  : 'border-emerald-400/25 bg-emerald-500/10 text-white hover:bg-emerald-500/15'
              )}
            >
              {creatingStage ? 'Añadiendo…' : '+ Columna'}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      {/* BOARD + RIGHT PANEL */}
      <div className="mt-6">
        <div className={cx('flex gap-4', rightPanelOpen ? 'items-stretch' : '')}>
          {/* LEFT: BOARD */}
          <div className={cx('min-w-0 flex-1')}>
            {boardLoading ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">Cargando board…</div>
            ) : !boardHasStages ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
                {selectedPipeline ? 'Este pipeline no tiene stages.' : 'Selecciona un pipeline.'}
              </div>
            ) : (
              <div className={cx('rounded-2xl border border-white/10 bg-black/10 p-3', 'h-[calc(100vh-380px)] min-h-[440px]')}>
                <div className="h-full overflow-x-auto">
                  <div className="flex h-full pr-2">
                    {/* GAP inicial (insertar columna al principio) */}
                    <div
                      onDragOver={(e) => onDragOverStageGap(e, 0)}
                      onDrop={(e) => void onDropStageGap(e, 0)}
                      onDragLeave={() => setDragOverStageIndex(null)}
                      className={cx(
                        'h-full w-2 shrink-0 rounded-xl transition',
                        draggingStageId
                          ? dragOverStageIndex === 0
                            ? 'bg-indigo-400/25'
                            : 'bg-white/5'
                          : 'bg-transparent'
                      )}
                    />

                    {stages.map((st, idx) => {
                      const items = Array.isArray(leadsByStage[st.id]) ? leadsByStage[st.id]! : [];
                      const canDelete = stages.length > 1;

                      const stageAura =
                        draggingStageId === st.id
                          ? 'border-indigo-400/45 ring-2 ring-indigo-400/25 shadow-[0_0_0_1px_rgba(99,102,241,0.18),0_0_28px_rgba(99,102,241,0.22)] bg-indigo-500/10'
                          : 'border-white/10';

                      return (
                        <div key={st.id} className="flex h-full">
                          <div
                            onDragOver={onDragOverColumn}
                            onDrop={(e) => void onDropColumn(e, st.id)}
                            className={cx('flex h-full w-[300px] shrink-0 flex-col rounded-2xl border bg-white/5 p-3 transition', stageAura)}
                          >
                            {/* HEADER: drag columnas */}
                            <div
                              draggable
                              onDragStart={(e) => {
                                if (!selectedPipelineId) return;
                                onDragStartStage(e, { stageId: st.id, pipelineId: selectedPipelineId });
                              }}
                              onDragEnd={onDragEndStage}
                              className="cursor-grab active:cursor-grabbing select-none pb-2 mb-2 border-b border-white/10"
                              title="Arrastra para reordenar columnas"
                            >
                              <div className="flex items-center justify-between gap-2 min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <GripVertical className="h-4 w-4 text-white/35 shrink-0" />
                                  <p className="text-sm font-semibold text-white/90 truncate">{st.name}</p>
                                </div>
                                <span className="text-[11px] text-white/45">{items.length}</span>
                              </div>
                              <p className="mt-0.5 text-[11px] text-white/45">Arrastra para reordenar</p>
                            </div>

                            {/* Acciones */}
                            <div className="mb-3 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => openRename(st.id)}
                                className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-white/80 hover:bg-black/30"
                              >
                                Renombrar
                              </button>

                              <button
                                type="button"
                                onClick={() => openDelete(st.id)}
                                disabled={!canDelete}
                                className={cx(
                                  'rounded-lg border px-2 py-1 text-[11px]',
                                  !canDelete
                                    ? 'border-white/10 bg-white/5 text-white/35'
                                    : 'border-red-400/20 bg-red-500/10 text-red-100 hover:bg-red-500/15'
                                )}
                              >
                                Eliminar
                              </button>
                            </div>

                            {/* Lista con scroll */}
                            <div className="flex-1 overflow-y-auto pr-2" style={{ scrollbarGutter: 'stable' }}>
                              <div className="flex flex-col">
                                {/* GAP inicial (insertar lead al principio) */}
                                <div
                                  onDragOver={(e) => onDragOverLeadGap(e, st.id, 0)}
                                  onDrop={(e) => void onDropLeadGap(e, st.id, 0)}
                                  onDragLeave={onDragLeaveLeadGap}
                                  className={cx(
                                    'h-2 rounded-lg transition',
                                    draggingLeadId
                                      ? dragOverLead?.stageId === st.id && dragOverLead.index === 0
                                        ? 'bg-emerald-400/25'
                                        : 'bg-white/5'
                                      : 'bg-transparent'
                                  )}
                                />

                                {items.map((lead, leadIdx) => {
                                  const isSelected = selectedLeadId === lead.id;
                                  const isDragging = draggingLeadId === lead.id;

                                  const aura =
                                    isDragging || isSelected
                                      ? 'border-emerald-400/45 ring-2 ring-emerald-400/25 shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_0_24px_rgba(16,185,129,0.18)]'
                                      : 'border-white/10 hover:border-white/20';

                                  return (
                                    <div key={lead.id} className="flex flex-col">
                                      <div
                                        draggable
                                        onDragStart={(e) => {
                                          if (!selectedPipelineId) return;
                                          setSelectedLeadId(lead.id);
                                          onDragStartLead(e, {
                                            leadId: lead.id,
                                            fromStageId: st.id,
                                            pipelineId: selectedPipelineId,
                                          });
                                        }}
                                        onDragEnd={onDragEndLead}
                                        onClick={() => setSelectedLeadId(lead.id)}
                                        className={cx(
                                          'cursor-grab active:cursor-grabbing rounded-xl border bg-black/25 p-3 transition',
                                          aura,
                                          isDragging ? 'opacity-95' : '',
                                          'hover:bg-black/30'
                                        )}
                                        role="button"
                                        tabIndex={0}
                                      >
                                        <p className="text-sm font-semibold text-white truncate">{lead.full_name ?? 'Sin nombre'}</p>

                                        <div className="mt-1 space-y-1">
                                          {lead.email ? <p className="text-[12px] text-white/70 truncate">{lead.email}</p> : null}
                                          {lead.phone ? <p className="text-[12px] text-white/70 truncate">{lead.phone}</p> : null}

                                          <div className="flex items-center gap-2 pt-1">
                                            {lead.source ? (
                                              <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70">
                                                {lead.source}
                                              </span>
                                            ) : null}
                                            <span className="text-[11px] text-white/45">{formatLocal(lead.created_at)}</span>
                                          </div>
                                        </div>
                                      </div>

                                      {/* GAP después de este lead (insertar en leadIdx+1) */}
                                      <div
                                        onDragOver={(e) => onDragOverLeadGap(e, st.id, leadIdx + 1)}
                                        onDrop={(e) => void onDropLeadGap(e, st.id, leadIdx + 1)}
                                        onDragLeave={onDragLeaveLeadGap}
                                        className={cx(
                                          'h-2 mt-2 rounded-lg transition',
                                          draggingLeadId
                                            ? dragOverLead?.stageId === st.id && dragOverLead.index === leadIdx + 1
                                              ? 'bg-emerald-400/25'
                                              : 'bg-white/5'
                                            : 'bg-transparent'
                                        )}
                                      />
                                    </div>
                                  );
                                })}

                                {items.length === 0 ? (
                                  <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white/60">
                                    Suelta aquí…
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          {/* GAP después de esta columna (insertar columna en idx+1) */}
                          <div
                            onDragOver={(e) => onDragOverStageGap(e, idx + 1)}
                            onDrop={(e) => void onDropStageGap(e, idx + 1)}
                            onDragLeave={() => setDragOverStageIndex(null)}
                            className={cx(
                              'h-full w-2 shrink-0 ml-3 rounded-xl transition',
                              draggingStageId
                                ? dragOverStageIndex === idx + 1
                                  ? 'bg-indigo-400/25'
                                  : 'bg-white/5'
                                : 'bg-transparent'
                            )}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: LEAD PANEL (desktop) */}
          {rightPanelOpen ? (
            <aside className="hidden lg:block w-[360px] shrink-0">
              <div className="h-[calc(100vh-380px)] min-h-[440px] rounded-2xl border border-white/10 bg-black/20 backdrop-blur-[10px] p-4 flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-white/55">Lead</p>
                    <p className="mt-0.5 text-lg font-semibold text-white truncate">
                      {selectedLead?.full_name ?? 'Sin nombre'}
                    </p>
                    <p className="mt-0.5 text-xs text-white/55 truncate">{selectedLead?.id ?? '—'}</p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedLeadId(null)}
                    className="rounded-xl border border-white/10 bg-white/5 p-2 text-white/80 hover:bg-white/10"
                    title="Cerrar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void (selectedLead?.id ? copyToClipboard(selectedLead.id) : Promise.resolve(false))}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
                  >
                    <Copy className="h-4 w-4 text-white/60" />
                    Copiar ID
                  </button>

                  {selectedLead?.id ? (
                    <Link
                      href={`/leads?selected=${encodeURIComponent(selectedLead.id)}`}
                      className="inline-flex items-center justify-center rounded-xl border border-indigo-400/25 bg-indigo-500/10 px-3 py-2 text-xs text-white hover:bg-indigo-500/15"
                    >
                      Ver lead
                    </Link>
                  ) : null}
                </div>

                <div className="mt-4 space-y-3 overflow-y-auto pr-1" style={{ scrollbarGutter: 'stable' }}>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-white/55">Contacto</p>
                    <div className="mt-2 space-y-1">
                      {selectedLead?.email ? <p className="text-sm text-white/85 truncate">{selectedLead.email}</p> : <p className="text-sm text-white/50">—</p>}
                      {selectedLead?.phone ? <p className="text-sm text-white/85 truncate">{selectedLead.phone}</p> : null}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-white/55">Estado</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedLead?.source ? (
                        <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-white/75">
                          {selectedLead.source}
                        </span>
                      ) : (
                        <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-white/45">sin source</span>
                      )}

                      {selectedLead?.status ? (
                        <span className="rounded-lg border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-white/75">
                          {selectedLead.status}
                        </span>
                      ) : null}

                      {selectedLeadStageName ? (
                        <span className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-100">
                          {selectedLeadStageName}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 text-xs text-white/55 space-y-1">
                      <p>
                        Creado: <span className="text-white/75">{selectedLead?.created_at ? formatLocal(selectedLead.created_at) : '—'}</span>
                      </p>
                      <p>
                        Último cambio stage:{' '}
                        <span className="text-white/75">{selectedLead?.stage_changed_at ? formatLocal(selectedLead.stage_changed_at) : '—'}</span>
                      </p>
                      <p>
                        Pipeline:{' '}
                        <span className="text-white/75">{selectedPipeline?.name ?? '—'}</span>
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-white/55">Labels</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(selectedLead?.labels ?? []).length > 0 ? (
                        (selectedLead?.labels ?? []).map((lab) => (
                          <span
                            key={lab}
                            className="rounded-lg border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-white/75"
                          >
                            {lab}
                          </span>
                        ))
                      ) : (
                        <p className="text-sm text-white/50">—</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <p className="text-xs text-white/55">Notes</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-white/80">
                      {selectedLead?.notes?.trim() ? selectedLead.notes : '—'}
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      {/* Estado */}
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
        <p className="text-sm font-semibold text-white/90">Estado</p>
        <p className="mt-1 text-sm text-white/60">
          Workspace: <span className="text-white/85">{activeWorkspaceId ?? '—'}</span> · Pipeline:{' '}
          <span className="text-white/85">{selectedPipeline?.name ?? '—'}</span>
        </p>
      </div>

      {/* MODAL RENOMBRAR */}
      {renameOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => (renaming ? null : setRenameOpen(false))} />
          <div className="relative w-full max-w-[520px] rounded-2xl border border-white/10 bg-black/60 backdrop-blur-[10px] p-5">
            <p className="text-lg font-semibold text-white">Renombrar columna</p>
            <p className="mt-1 text-sm text-white/60">Cambia el nombre de la columna seleccionada.</p>

            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="mt-4 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/30"
              placeholder="Nuevo nombre"
              disabled={renaming}
            />

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameOpen(false)}
                disabled={renaming}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void doRename()}
                disabled={renaming || renameValue.trim().length === 0}
                className={cx(
                  'rounded-xl border px-4 py-2 text-sm',
                  renaming || renameValue.trim().length === 0
                    ? 'border-white/10 bg-white/5 text-white/40'
                    : 'border-indigo-400/25 bg-indigo-500/10 text-white hover:bg-indigo-500/15'
                )}
              >
                {renaming ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL ELIMINAR */}
      {deleteOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => (deleting ? null : setDeleteOpen(false))} />
          <div className="relative w-full max-w-[560px] rounded-2xl border border-white/10 bg-black/60 backdrop-blur-[10px] p-5">
            <p className="text-lg font-semibold text-white">Eliminar columna</p>
            <p className="mt-1 text-sm text-white/60">Los leads se moverán a otra columna antes de eliminarla.</p>

            <div className="mt-4">
              <p className="text-xs text-white/55">Mover leads a:</p>
              <select
                value={deleteToStageId}
                onChange={(e) => setDeleteToStageId(e.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none"
                disabled={deleting}
              >
                {stages
                  .filter((s) => s.id !== deleteStageId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void doDelete()}
                disabled={deleting || !deleteToStageId}
                className={cx(
                  'rounded-xl border px-4 py-2 text-sm',
                  deleting || !deleteToStageId
                    ? 'border-white/10 bg-white/5 text-white/40'
                    : 'border-red-400/20 bg-red-500/10 text-red-100 hover:bg-red-500/15'
                )}
              >
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}