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
  return typeof v === 'string' && v.trim() ? v : null;
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

  // 1) Busca workflows activos del workspace
  // Nota: asumimos que workflow_nodes.config contiene trigger {event,toStageId?}
  const { data: wfs, error: wErr } = await sb
    .from('workflows')
    .select('id, status')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');

  if (wErr) return json(500, { ok: false, error: 'workflows_fetch_failed', detail: wErr.message });
  const workflowIds = (wfs ?? []).map((w) => w.id).filter((x): x is string => typeof x === 'string');

  if (workflowIds.length === 0) return json(200, { ok: true, triggered: 0 });

  // 2) Para cada workflow, localiza nodos trigger compatibles y edges desde trigger → actions
  // (v1 simple: si hay múltiples triggers, disparará el primero que matchee)
  const { data: nodes, error: nErr } = await sb
    .from('workflow_nodes')
    .select('id, workflow_id, type, config')
    .in('workflow_id', workflowIds);

  if (nErr) return json(500, { ok: false, error: 'nodes_fetch_failed', detail: nErr.message });

  const { data: edges, error: eErr } = await sb
    .from('workflow_edges')
    .select('id, workflow_id, from_node_id, to_node_id')
    .in('workflow_id', workflowIds);

  // Si tu tabla de edges se llama distinto, cambia "workflow_edges".
  if (eErr) return json(500, { ok: false, error: 'edges_fetch_failed', detail: eErr.message });

  type TriggerNode = { id: string; workflow_id: string; config: unknown };
  const triggers: TriggerNode[] =
    (nodes ?? [])
      .filter((r) => r && r.type === 'trigger' && typeof r.id === 'string' && typeof r.workflow_id === 'string')
      .map((r) => ({ id: r.id as string, workflow_id: r.workflow_id as string, config: (r as { config: unknown }).config }));

  const matches: Array<{ workflowId: string; triggerNodeId: string }> = [];
  for (const t of triggers) {
    const cfg = isRecord(t.config) ? t.config : {};
    if (cfg.event !== 'lead.stage_changed') continue;
    const onlyToStage = typeof cfg.toStageId === 'string' && cfg.toStageId.trim() ? cfg.toStageId.trim() : null;
    if (onlyToStage && onlyToStage !== toStageId) continue;
    matches.push({ workflowId: t.workflow_id, triggerNodeId: t.id });
  }

  if (matches.length === 0) return json(200, { ok: true, triggered: 0 });

  // 3) Crea workflow_runs + steps iniciales (nodos destino de edges desde trigger)
  let triggered = 0;

  for (const m of matches) {
    const outgoing = (edges ?? [])
      .filter((e) => e && e.from_node_id === m.triggerNodeId && typeof e.to_node_id === 'string')
      .map((e) => e.to_node_id as string);

    if (outgoing.length === 0) continue;

    const { data: runRow, error: rErr2 } = await sb
      .from('workflow_runs')
      .insert({
        workflow_id: m.workflowId,
        workspace_id: workspaceId,
        status: 'running',
        context: { leadId, pipelineId, fromStageId, toStageId },
      })
      .select('id')
      .single();

    if (rErr2 || !runRow?.id) continue;

    const runId = runRow.id as string;

    // Insert steps (idempotencia por unique(run_id,node_id))
    const stepRows = outgoing.map((nodeId) => ({
      run_id: runId,
      node_id: nodeId,
      status: 'queued',
      scheduled_for: new Date().toISOString(),
    }));

    await sb.from('workflow_run_steps').insert(stepRows, { returning: 'minimal' });

    triggered += 1;
  }

  return json(200, { ok: true, triggered });
}