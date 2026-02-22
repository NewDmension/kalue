// src/app/api/automations/runner/process-queue/route.ts
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickString(obj: unknown, key: string): string | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

type QueueRow = {
  id: string;
  workspace_id: string;
  event_type: string;
  entity_id: string;
  payload: unknown;
  created_at: string;
  processed_at: string | null;
  locked_at: string | null;
};

type WorkflowRow = {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
};

type NodeRow = {
  id: string;
  workflow_id: string;
  type: string;
  name: string;
  config: unknown;
};

type EdgeRow = {
  id: string;
  workflow_id: string;
  from_node_id: string;
  to_node_id: string;
  condition_key: string | null;
};

type TriggerConfig = {
  event: 'lead.stage_changed';
  toStageId?: string;
};

type ActionAddLabelConfig = {
  action: 'lead.add_label';
  label: string;
};

function isTriggerConfig(v: unknown): v is TriggerConfig {
  if (!isRecord(v)) return false;
  return v.event === 'lead.stage_changed';
}

function isActionAddLabelConfig(v: unknown): v is ActionAddLabelConfig {
  if (!isRecord(v)) return false;
  return v.action === 'lead.add_label' && typeof v.label === 'string' && v.label.trim().length > 0;
}

function payloadToStageId(payload: unknown): string | null {
  // ✅ Preferimos toStageId (move-lead), fallback a stageId si algún sitio lo manda distinto
  return pickString(payload, 'toStageId') ?? pickString(payload, 'stageId');
}

function payloadActor(payload: unknown): string | null {
  return pickString(payload, 'actorUserId');
}

async function markProcessed(admin: SupabaseClient, eventId: string): Promise<void> {
  const { error } = await admin
    .from('workflow_event_queue')
    .update({ processed_at: new Date().toISOString(), locked_at: null })
    .eq('id', eventId);

  if (error) {
    // eslint-disable-next-line no-console
    console.error('markProcessed failed', error.message);
  }
}

async function unlockEvent(admin: SupabaseClient, eventId: string): Promise<void> {
  const { error } = await admin.from('workflow_event_queue').update({ locked_at: null }).eq('id', eventId);
  if (error) {
    // eslint-disable-next-line no-console
    console.error('unlockEvent failed', error.message);
  }
}

/**
 * ✅ IMPORTANTE: devuelve SIEMPRE una forma discriminable:
 * - { skipped: true, runId: null }
 * - { skipped: false, runId: string }
 */
type EnsureRunResult = { skipped: true; runId: null } | { skipped: false; runId: string };

async function ensureRun(
  admin: SupabaseClient,
  args: {
    workflow: WorkflowRow;
    event: QueueRow;
    entityType: 'lead';
    entityId: string;
    actorUserId: string | null;
  }
): Promise<EnsureRunResult> {
  const ins = await admin
    .from('workflow_runs')
    .insert({
      workflow_id: args.workflow.id,
      workspace_id: args.workflow.workspace_id,
      entity_type: args.entityType,
      entity_id: args.entityId,
      status: 'running',
      started_at: new Date().toISOString(),
      source_event_id: args.event.id,
      error: null,
    })
    .select('id')
    .single();

  if (ins.error) {
    if (ins.error.code === '23505') return { skipped: true, runId: null };
    // eslint-disable-next-line no-console
    console.error('ensureRun insert failed', ins.error.message);
    throw new Error(ins.error.message);
  }

  const runId = (ins.data as { id?: unknown } | null)?.id;
  if (typeof runId !== 'string' || !runId.trim()) throw new Error('ensureRun_missing_id');

  return { skipped: false, runId: runId.trim() };
}

async function finishRun(
  admin: SupabaseClient,
  args: { runId: string; status: 'completed' | 'failed'; error: string | null }
): Promise<void> {
  const { error } = await admin
    .from('workflow_runs')
    .update({
      status: args.status,
      finished_at: new Date().toISOString(),
      error: args.error,
    })
    .eq('id', args.runId);

  if (error) {
    // eslint-disable-next-line no-console
    console.error('finishRun failed', error.message);
  }
}

async function execAddLabel(
  admin: SupabaseClient,
  args: { workspaceId: string; leadId: string; label: string }
): Promise<void> {
  const sel = await admin
    .from('leads')
    .select('labels')
    .eq('workspace_id', args.workspaceId)
    .eq('id', args.leadId)
    .maybeSingle();

  if (sel.error) throw new Error(sel.error.message);

  const cur = (sel.data as { labels?: unknown } | null)?.labels;
  const labels: string[] = Array.isArray(cur) ? cur.filter((x): x is string => typeof x === 'string') : [];

  const normalized = args.label.trim();
  if (!normalized) return;
  if (labels.includes(normalized)) return;

  const next = [...labels, normalized];

  const upd = await admin
    .from('leads')
    .update({ labels: next })
    .eq('workspace_id', args.workspaceId)
    .eq('id', args.leadId);

  if (upd.error) throw new Error(upd.error.message);
}

/**
 * ✅ NUEVO MATCHING: workflows asignados a la COLUMNA (stage)
 * - tabla: stage_workflows
 * - opcional: filtrar workflows.status = 'active'
 */
async function findMatchingWorkflows(
  admin: SupabaseClient,
  args: { workspaceId: string; event: QueueRow }
): Promise<string[]> {
  // 1) stage destino desde payload
  const toStageId = payloadToStageId(args.event.payload);
  if (!toStageId) return [];

  // 2) traer asignaciones activas a ese stage
  const assignRes = await admin
    .from('stage_workflows')
    .select('workflow_id')
    .eq('workspace_id', args.workspaceId)
    .eq('stage_id', toStageId)
    .eq('is_active', true);

  if (assignRes.error) throw new Error(assignRes.error.message);

  const assignedWorkflowIds: string[] = Array.isArray(assignRes.data)
    ? assignRes.data
        .map((r) => (isRecord(r) ? pickString(r, 'workflow_id') : null))
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];

  if (assignedWorkflowIds.length === 0) return [];

  // 3) filtrar a workflows activos (seguridad)
  const wfRes = await admin
    .from('workflows')
    .select('id')
    .eq('workspace_id', args.workspaceId)
    .eq('status', 'active')
    .in('id', assignedWorkflowIds);

  if (wfRes.error) throw new Error(wfRes.error.message);

  const wfIds: string[] = Array.isArray(wfRes.data)
    ? wfRes.data
        .map((r) => (isRecord(r) ? pickString(r, 'id') : null))
        .filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];

  if (wfIds.length === 0) return [];

  // 4) filtro por trigger match (igual que antes)
  const nodesRes = await admin
    .from('workflow_nodes')
    .select('id, workflow_id, type, name, config')
    .in('workflow_id', wfIds)
    .eq('type', 'trigger');

  if (nodesRes.error) throw new Error(nodesRes.error.message);

  const trigNodes = (nodesRes.data ?? []) as unknown as NodeRow[];

  const matched = new Set<string>();

  for (const n of trigNodes) {
    if (!isTriggerConfig(n.config)) continue;
    if (n.config.event !== args.event.event_type) continue;

    // filtro opcional del trigger por toStageId
    const tcfg = n.config as TriggerConfig;
    if (typeof tcfg.toStageId === 'string' && tcfg.toStageId.trim()) {
      if (tcfg.toStageId !== toStageId) continue;
    }

    matched.add(n.workflow_id);
  }

  return Array.from(matched);
}

async function loadGraph(admin: SupabaseClient, workflowId: string): Promise<{ nodes: NodeRow[]; edges: EdgeRow[] }> {
  const [nRes, eRes] = await Promise.all([
    admin.from('workflow_nodes').select('id, workflow_id, type, name, config').eq('workflow_id', workflowId),
    admin
      .from('workflow_edges')
      .select('id, workflow_id, from_node_id, to_node_id, condition_key')
      .eq('workflow_id', workflowId),
  ]);

  if (nRes.error) throw new Error(nRes.error.message);
  if (eRes.error) throw new Error(eRes.error.message);

  return {
    nodes: (nRes.data ?? []) as unknown as NodeRow[],
    edges: (eRes.data ?? []) as unknown as EdgeRow[],
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const secret = getEnv('KALUE_CRON_SECRET');
    const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!got || got !== secret) return json(401, { ok: false, error: 'unauthorized' });

    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const claim = await admin.rpc('claim_workflow_events', { p_limit: 10 });
    if (claim.error) return json(500, { ok: false, error: 'db_error', detail: claim.error.message });

    const events = (claim.data ?? []) as unknown as QueueRow[];
    if (events.length === 0) return json(200, { ok: true, processed: 0 });

    let processed = 0;

    for (const ev of events) {
      try {
        if (ev.event_type !== 'lead.stage_changed') {
          await markProcessed(admin, ev.id);
          processed += 1;
          continue;
        }

        const wfIds = await findMatchingWorkflows(admin, { workspaceId: ev.workspace_id, event: ev });

        if (wfIds.length === 0) {
          await markProcessed(admin, ev.id);
          processed += 1;
          continue;
        }

        for (const workflowId of wfIds) {
          const wfRes = await admin
            .from('workflows')
            .select('id, workspace_id, name, status')
            .eq('id', workflowId)
            .single();

          if (wfRes.error) throw new Error(wfRes.error.message);
          const wf = wfRes.data as unknown as WorkflowRow;

          const run = await ensureRun(admin, {
            workflow: wf,
            event: ev,
            entityType: 'lead',
            entityId: ev.entity_id,
            actorUserId: payloadActor(ev.payload),
          });

          // ✅ idempotencia: ya existe run para (workflow_id + source_event_id)
          if (run.skipped) continue;

          const graph = await loadGraph(admin, workflowId);

          const triggers = graph.nodes.filter(
            (n) => n.type === 'trigger' && isTriggerConfig(n.config) && n.config.event === 'lead.stage_changed'
          );

          const nodeById = new Map<string, NodeRow>();
          for (const n of graph.nodes) nodeById.set(n.id, n);

          let ranAny = false;

          for (const t of triggers) {
            const toStageId = payloadToStageId(ev.payload);
            const tcfg = t.config as TriggerConfig;

            if (typeof tcfg.toStageId === 'string' && tcfg.toStageId.trim()) {
              if (!toStageId || tcfg.toStageId !== toStageId) continue;
            }

            const outs = graph.edges.filter((e) => e.from_node_id === t.id);
            for (const edge of outs) {
              const target = nodeById.get(edge.to_node_id);
              if (!target) continue;
              if (target.type !== 'action') continue;

              if (isActionAddLabelConfig(target.config)) {
                await execAddLabel(admin, {
                  workspaceId: ev.workspace_id,
                  leadId: ev.entity_id,
                  label: target.config.label,
                });
                ranAny = true;
              }
            }
          }

          await finishRun(admin, {
            runId: run.runId,
            status: 'completed',
            error: ranAny ? null : 'no_action_executed',
          });
        }

        await markProcessed(admin, ev.id);
        processed += 1;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'runner_error';
        // eslint-disable-next-line no-console
        console.error('process event failed', ev.id, msg);
        await unlockEvent(admin, ev.id);
      }
    }

    return json(200, { ok: true, processed });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
