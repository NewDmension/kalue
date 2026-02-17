'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';

type Stage = {
  id: string;
  name: string;
  sort_order: number;
  color: string | null;
  is_won: boolean;
  is_lost: boolean;
};

type Lead = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  source: string | null;
  status: string;
};

type BoardResponse = {
  ok: true;
  stages: Stage[];
  leadsByStage: Record<string, Array<Lead & { stage_id: string; position: number }>>;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

async function apiGet<T>(url: string, workspaceId: string): Promise<T> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      'x-workspace-id': workspaceId,
    },
    cache: 'no-store',
  });
  const data = (await res.json()) as T;
  return data;
}

async function apiPost(url: string, workspaceId: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-workspace-id': workspaceId,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return (await res.json()) as unknown;
}

export function LeadsKanbanBoard(props: { workspaceId: string; pipelineId: string }) {
  const { workspaceId, pipelineId } = props;

  const [stages, setStages] = useState<Stage[]>([]);
  const [leadsByStage, setLeadsByStage] = useState<Record<string, Array<Lead & { stage_id: string; position: number }>>>(
    {},
  );
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<BoardResponse>(`/api/pipelines/board?pipelineId=${encodeURIComponent(pipelineId)}`, workspaceId);
      if (data.ok) {
        setStages(data.stages);
        setLeadsByStage(data.leadsByStage ?? {});
      }
    } finally {
      setLoading(false);
    }
  }, [pipelineId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stageIds = useMemo(() => stages.map((s) => s.id), [stages]);

  const handleDragStart = useCallback((ev: DragStartEvent) => {
    const id = typeof ev.active.id === 'string' ? ev.active.id : null;
    setActiveLeadId(id);
  }, []);

  const handleDragEnd = useCallback(
    async (ev: DragEndEvent) => {
      setActiveLeadId(null);

      const activeId = typeof ev.active.id === 'string' ? ev.active.id : '';
      const overId = typeof ev.over?.id === 'string' ? ev.over?.id : '';

      if (!activeId || !overId) return;

      // Formato IDs:
      // - lead: `lead:<leadId>`
      // - stage dropzone: `stage:<stageId>`
      const a = activeId.startsWith('lead:') ? activeId.slice(5) : '';
      if (!a) return;

      let toStageId = '';
      let toIndex = 0;

      if (overId.startsWith('stage:')) {
        toStageId = overId.slice(6);
        const arr = leadsByStage[toStageId] ?? [];
        toIndex = arr.length; // lo ponemos al final
      } else if (overId.startsWith('lead:')) {
        const overLeadId = overId.slice(5);
        // localizar stage del over lead
        let foundStage: string | null = null;
        for (const sid of stageIds) {
          const arr = leadsByStage[sid] ?? [];
          const idx = arr.findIndex((x) => x.id === overLeadId);
          if (idx >= 0) {
            foundStage = sid;
            toIndex = idx;
            break;
          }
        }
        if (!foundStage) return;
        toStageId = foundStage;
      } else {
        return;
      }

      // localizar stage actual del active lead
      let fromStageId: string | null = null;
      let fromIndex = -1;
      for (const sid of stageIds) {
        const arr = leadsByStage[sid] ?? [];
        const idx = arr.findIndex((x) => x.id === a);
        if (idx >= 0) {
          fromStageId = sid;
          fromIndex = idx;
          break;
        }
      }
      if (!fromStageId || fromIndex < 0) return;

      // Optimistic UI
      setLeadsByStage((prev) => {
        const next: Record<string, Array<Lead & { stage_id: string; position: number }>> = { ...prev };
        const fromArr = [...(next[fromStageId] ?? [])];
        const [moved] = fromArr.splice(fromIndex, 1);
        if (!moved) return prev;

        const toArr = fromStageId === toStageId ? fromArr : [...(next[toStageId] ?? [])];
        const safeIndex = Math.max(0, Math.min(toIndex, toArr.length));
        const moved2 = { ...moved, stage_id: toStageId };
        toArr.splice(safeIndex, 0, moved2);

        if (fromStageId === toStageId) {
          next[toStageId] = toArr.map((x, i) => ({ ...x, position: i }));
        } else {
          next[fromStageId] = fromArr.map((x, i) => ({ ...x, position: i }));
          next[toStageId] = toArr.map((x, i) => ({ ...x, position: i }));
        }
        return next;
      });

      // Persistencia
      const resp = await apiPost('/api/pipelines/move-lead', workspaceId, {
        pipelineId,
        leadId: a,
        toStageId,
        toPosition: toIndex,
      });

      // Si falla, recargamos desde backend (estado canonical)
      const okResp = typeof resp === 'object' && resp !== null && 'ok' in resp && (resp as { ok?: unknown }).ok === true;
      if (!okResp) {
        await load();
      }
    },
    [leadsByStage, load, pipelineId, stageIds, workspaceId],
  );

  if (loading) {
    return <div className="text-sm text-white/70">Cargando pipeline…</div>;
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {stages.map((stage) => {
          const leads = leadsByStage[stage.id] ?? [];
          return (
            <div key={stage.id} className="rounded-2xl border border-white/10 bg-white/5 p-3 shadow">
              <div className="mb-3 flex items-center justify-between">
                <div className="font-medium text-white/90">{stage.name}</div>
                <div className="text-xs text-white/60">{leads.length}</div>
              </div>

              {/* dropzone stage */}
              <div id={`stage:${stage.id}`} className="min-h-[120px] rounded-xl bg-black/10 p-2">
                <SortableContext
                  items={leads.map((l) => `lead:${l.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {leads.map((lead) => (
                      <div
                        key={lead.id}
                        id={`lead:${lead.id}`}
                        className={cx(
                          'cursor-grab rounded-xl border border-white/10 bg-white/10 p-3',
                          activeLeadId === `lead:${lead.id}` && 'opacity-60',
                        )}
                      >
                        <div className="text-sm font-medium text-white/90">{lead.full_name ?? 'Sin nombre'}</div>
                        <div className="mt-1 text-xs text-white/70">{lead.email ?? lead.phone ?? '—'}</div>
                        <div className="mt-2 text-[11px] text-white/50">{lead.source ?? '—'}</div>
                      </div>
                    ))}
                  </div>
                </SortableContext>
              </div>
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}
