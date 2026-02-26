// src/app/api/automations/triggers/lead-stage-changed/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/supabase/serviceRole';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Body = {
  workspaceId: string;
  leadId: string;
  pipelineId: string;
  fromStageId?: string;
  toStageId: string;
};

type WorkflowRow = { id: string; status: string };

type NodeRow = {
  id: string;
  workflow_id: string;
  type: string;
  config: unknown;
};

type EdgeRow = {
  id: string;
  workflow_id: string;
  from_node_id: string;
  to_node_id: string;
};

type TriggerConfig = {
  event: 'lead.stage_changed';
  toStageId?: string;
};

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function pickPgErrorCode(err: unknown): string | null {
  if (!isRecord(err)) return null;
  const code = err.code;
  return typeof code === 'string' && code.trim() ? code.trim() : null;
}

function asTriggerConfig(v: unknown): TriggerConfig | null {
  if (!isRecord(v)) return null;
  const ev = v.event;
  if (ev !== 'lead.stage_changed') return null;

  const toStageRaw = v.toStageId;
  const toStageId = typeof toStageRaw === 'string' && toStageRaw.trim() ? toStageRaw.trim() : undefined;

  return { event: 'lead.stage_changed', toStageId };
}

function toNodeRows(rows: unknown): NodeRow[] {
  if (!Array.isArray(rows)) return [];
  const out: NodeRow[] = [];
  for (const r of rows) {
    if (!isRecord(r)) continue;
    const id = pickStr(r, 'id');
    const workflowId = pickStr(r, 'workflow_id');
    const type = pickStr(r, 'type');
    // config puede ser cualquier cosa
    const config = (r as { config?: unknown }).config;

    if (!id || !workflowId || !type) continue;
    out.push({ id, workflow_id: workflowId, type, config });
  }
  return out;
}

function toEdgeRows(rows: unknown): EdgeRow[] {
  if (!Array.isArray(rows)) return [];
  const out: EdgeRow[] = [];
  for (const r of rows) {
    if (!isRecord(r)) continue;
    const id = pickStr(r, 'id');
    const workflowId = pickStr(r, 'workflow_id');
    const from = pickStr(r, 'from_node_id');
    const to = pickStr(r, 'to_node_id');
    if (!id || !workflowId || !from || !to) continue;
    out.push({ id, workflow_id: workflowId, from_node_id: from, to_node_id: to });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const sb = supabaseServiceRole();

  let bodyUnknown: unknown = null;
  try {
    bodyUnknown = (await req.json()) as unknown;
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }
  if (!isRecord(bodyUnknown)) return json(400, { ok: false, error: 'invalid_body' });

  const workspaceId = pickStr(bodyUnknown, 'workspaceId');
  const leadId = pickStr(bodyUnknown, 'leadId');
  const pipelineId = pickStr(bodyUnknown, 'pipelineId');
  const toStageId = pickStr(bodyUnknown, 'toStageId');
  const fromStageId = pickStr(bodyUnknown, 'fromStageId') ?? undefined;

  if (!workspaceId || !leadId || !pipelineId || !toStageId) {
    return json(400, { ok: false, error: 'missing_fields' });
  }

  // 1) Workflows activos del workspace
  const { data: wfs, error: wErr } = await sb
    .from('workflows')
    .select('id, status')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');

  if (wErr) return json(500, { ok: false, error: 'workflows_fetch_failed', detail: wErr.message });

  const workflowIds: string[] = Array.isArray(wfs)
    ? (wfs as WorkflowRow[])
        .map((w) => (typeof w.id === 'string' ? w.id : ''))
        .filter((id) => id.length > 0)
    : [];

  if (workflowIds.length === 0) return json(200, { ok: true, triggered: 0 });

  // 2) Nodes + edges del grafo
  const { data: nodesRaw, error: nErr } = await sb
    .from('workflow_nodes')
    .select('id, workflow_id, type, config')
    .in('workflow_id', workflowIds);

  if (nErr) return json(500, { ok: false, error: 'nodes_fetch_failed', detail: nErr.message });

  const { data: edgesRaw, error: eErr } = await sb
    .from('workflow_edges')
    .select('id, workflow_id, from_node_id, to_node_id')
    .in('workflow_id', workflowIds);

  if (eErr) return json(500, { ok: false, error: 'edges_fetch_failed', detail: eErr.message });

  const nodes: NodeRow[] = toNodeRows(nodesRaw);
  const edges: EdgeRow[] = toEdgeRows(edgesRaw);

  // 2.1) triggers que matchean lead.stage_changed (+ filtro opcional toStageId)
  const matches: Array<{ workflowId: string; triggerNodeId: string }> = [];

  for (const n of nodes) {
    if (n.type !== 'trigger') continue;
    const cfg = asTriggerConfig(n.config);
    if (!cfg) continue;

    if (cfg.toStageId && cfg.toStageId !== toStageId) continue;

    matches.push({ workflowId: n.workflow_id, triggerNodeId: n.id });
  }

  if (matches.length === 0) return json(200, { ok: true, triggered: 0 });

  // 3) Crea workflow_runs + steps iniciales (destinos de edges desde trigger)
  let triggered = 0;

  for (const m of matches) {
    const outgoing: string[] = edges
      .filter((e) => e.from_node_id === m.triggerNodeId)
      .map((e) => e.to_node_id);

    if (outgoing.length === 0) continue;

    const context: Record<string, unknown> = {
      leadId,
      pipelineId,
      fromStageId: fromStageId ?? null,
      toStageId,
    };

    const { data: runRow, error: rErr2 } = await sb
      .from('workflow_runs')
      .insert({
        workflow_id: m.workflowId,
        workspace_id: workspaceId,
        status: 'running',
        context,
      })
      .select('id')
      .single();

    if (rErr2 || !runRow?.id) continue;

    const runId = String(runRow.id);

    // Insert steps (idempotencia por unique(run_id,node_id))
    const nowIso = new Date().toISOString();
    const stepRows: Array<{ run_id: string; node_id: string; status: 'queued'; scheduled_for: string }> = outgoing.map(
      (nodeId: string) => ({
        run_id: runId,
        node_id: nodeId,
        status: 'queued',
        scheduled_for: nowIso,
      })
    );

    const ins = await sb.from('workflow_run_steps').insert(stepRows);
    if (ins.error) {
      // 23505 = unique violation (idempotencia). Lo ignoramos.
      const code = pickPgErrorCode(ins.error);
      if (code !== '23505') {
        // eslint-disable-next-line no-console
        console.error('insert workflow_run_steps failed', ins.error.message);
        continue;
      }
    }

    triggered += 1;
  }

  return json(200, { ok: true, triggered });
}