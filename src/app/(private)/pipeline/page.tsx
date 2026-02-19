// src/app/(private)/pipeline/page.tsx
'use client';

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useWorkspace } from '@/components/app/WorkspaceContext';
import { GripVertical } from 'lucide-react';

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

function safePos(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
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

  const selectedPipeline = useMemo(() => {
    if (!selectedPipelineId) return null;
    return pipelines.find((p) => p.id === selectedPipelineId) ?? null;
  }, [pipelines, selectedPipelineId]);

  const stagesById = useMemo(() => {
    const m = new Map<string, StageRow>();
    for (const s of stages) m.set(s.id, s);
    return m;
  }, [stages]);

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

  // ✅ Calcula un "position" estable entre vecinos (no uses índice como position)
  function computeToPosition(args: {
    leadId: string;
    fromStageId: string;
    toStageId: string;
    toIndex: number;
  }): number {
    const STEP = 1000;

    const rawArr = Array.isArray(leadsByStage[args.toStageId]) ? leadsByStage[args.toStageId]! : [];

    // si reordenas en el mismo stage, quita el lead primero (para calcular vecinos correctos)
    const arr =
      args.fromStageId === args.toStageId ? rawArr.filter((l) => l.id !== args.leadId) : rawArr;

    const boundedIndex = Math.max(0, Math.min(args.toIndex, arr.length));

    const prev = boundedIndex - 1 >= 0 ? arr[boundedIndex - 1] : null;
    const next = boundedIndex < arr.length ? arr[boundedIndex] : null;

    const prevPos = prev ? safePos(prev.position) : null;
    const nextPos = next ? safePos(next.position) : null;

    if (prevPos === null && nextPos === null) return STEP; // primera card del stage
    if (prevPos === null && nextPos !== null) return nextPos - STEP; // al principio
    if (prevPos !== null && nextPos === null) return prevPos + STEP; // al final

    // entre dos posiciones: elige un punto medio
    if (prevPos !== null && nextPos !== null) {
      if (nextPos - prevPos >= 2) {
        return prevPos + Math.floor((nextPos - prevPos) / 2);
      }
      // gap demasiado pequeño: igualmente mete algo "entre" (se va compactando, pero ordena)
      return prevPos + 1;
    }

    return STEP;
  }

  // ✅ mover o reordenar lead por índice (mismo stage o stage distinto)
  function optimisticUpsertLead(args: {
    leadId: string;
    fromStageId: string;
    toStageId: string;
    toIndex: number;
    toPosition: number;
  }): void {
    setLeadsByStage((prev) => {
      const next: Record<string, LeadRow[]> = { ...prev };

      const fromArr = Array.isArray(next[args.fromStageId]) ? [...next[args.fromStageId]!] : [];
      const toArr =
        args.fromStageId === args.toStageId
          ? fromArr
          : Array.isArray(next[args.toStageId])
            ? [...next[args.toStageId]!]
            : [];

      const fromIndex = fromArr.findIndex((l) => l.id === args.leadId);
      if (fromIndex < 0) return prev;

      const lead = fromArr[fromIndex]!;
      fromArr.splice(fromIndex, 1);

      const boundedIndex = Math.max(0, Math.min(args.toIndex, toArr.length));

      const moved: LeadRow = {
        ...lead,
        stage_id: args.toStageId,
        stage_changed_at: new Date().toISOString(),
        position: args.toPosition,
      };

      toArr.splice(boundedIndex, 0, moved);

      // ordenar por position para que el UI quede consistente con el backend
      toArr.sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        const ta = Date.parse(a.created_at);
        const tb = Date.parse(b.created_at);
        if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
        return ta - tb;
      });

      next[args.toStageId] = toArr;

      if (args.fromStageId !== args.toStageId) {
        // también ordenamos el fromArr por si acaso
        fromArr.sort((a, b) => {
          if (a.position !== b.position) return a.position - b.position;
          const ta = Date.parse(a.created_at);
          const tb = Date.parse(b.created_at);
          if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
          return ta - tb;
        });
        next[args.fromStageId] = fromArr;
      } else {
        next[args.fromStageId] = toArr;
      }

      return next;
    });
  }

  async function persistMoveLead(args: {
    leadId: string;
    toStageId: string;
    pipelineId: string;
    toPosition: number;
  }): Promise<boolean> {
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
  }

  function onDragOverColumn(e: DragEvent): void {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  // gaps para insertar leads
  function onDragOverLeadGap(e: DragEvent, stageId: string, index: number): void {
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes(DND_KEY_LEAD)) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverLead({ stageId, index });
  }

  function onDragLeaveLeadGap(): void {
    setDragOverLead(null);
  }

  async function onDropLeadGap(e: DragEvent, toStageId: string, toIndex: number): Promise<void> {
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes(DND_KEY_LEAD)) return;

    e.preventDefault();

    const raw = e.dataTransfer.getData(DND_KEY_LEAD) || e.dataTransfer.getData('text/plain');
    const payload = safeParseDragPayload(raw);
    if (!payload) return;

    if (!selectedPipelineId) return;
    if (payload.pipelineId !== selectedPipelineId) return;

    // si sueltas donde ya está (o justo al lado), no hagas nada
    if (payload.fromStageId === toStageId) {
      const current = Array.isArray(leadsByStage[toStageId]) ? leadsByStage[toStageId]! : [];
      const fromIndex = current.findIndex((l) => l.id === payload.leadId);
      if (fromIndex >= 0) {
        if (fromIndex === toIndex || fromIndex + 1 === toIndex) {
          setDragOverLead(null);
          return;
        }
      }
    }

    const toPosition = computeToPosition({
      leadId: payload.leadId,
      fromStageId: payload.fromStageId,
      toStageId,
      toIndex,
    });

    // Optimista
    optimisticUpsertLead({
      leadId: payload.leadId,
      fromStageId: payload.fromStageId,
      toStageId,
      toIndex,
      toPosition,
    });

    // Persist (position estable)
    const ok = await persistMoveLead({
      leadId: payload.leadId,
      pipelineId: payload.pipelineId,
      toStageId,
      toPosition,
    });

    if (!ok) {
      await loadBoard(payload.pipelineId);
    }

    setDragOverLead(null);
    setDraggingLeadId(null);
  }

  // Stage gaps
  function onDragOverStageGap(e: DragEvent, index: number): void {
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes(DND_KEY_STAGE)) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStageIndex(index);
  }

  async function onDropStageGap(e: DragEvent, targetIndex: number): Promise<void> {
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes(DND_KEY_STAGE)) return;

    e.preventDefault();

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
    e.preventDefault();

    setDragOverLead(null);
    setDraggingLeadId(null);

    const raw = e.dataTransfer.getData(DND_KEY_LEAD) || e.dataTransfer.getData('text/plain');
    const payload = safeParseDragPayload(raw);
    if (!payload) return;

    if (!selectedPipelineId) return;
    if (payload.pipelineId !== selectedPipelineId) return;

    const items = Array.isArray(leadsByStage[toStageId]) ? leadsByStage[toStageId]! : [];
    const toIndex = items.length;

    const toPosition = computeToPosition({
      leadId: payload.leadId,
      fromStageId: payload.fromStageId,
      toStageId,
      toIndex,
    });

    optimisticUpsertLead({
      leadId: payload.leadId,
      fromStageId: payload.fromStageId,
      toStageId,
      toIndex,
      toPosition,
    });

    const ok = await persistMoveLead({
      leadId: payload.leadId,
      pipelineId: payload.pipelineId,
      toStageId,
      toPosition,
    });

    if (!ok) {
      await loadBoard(payload.pipelineId);
    }
  }

  const boardHasStages = stages.length > 0;

  const canCreateStage = Boolean(activeWorkspaceId && selectedPipelineId);
  const canCreatePipeline = Boolean(activeWorkspaceId);

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

      {/* BOARD */}
      <div className="mt-6">
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
                      {/* COLUMNA */}
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
