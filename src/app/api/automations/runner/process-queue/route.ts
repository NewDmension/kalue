// src/app/api/automations/runner/process-queue/route.ts
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  // Esperamos payload.toStageId desde move-lead
  return pickString(payload, 'toStageId');
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

type EnsureRunResult = { runId: string } | { skipped: true };

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
  // Idempotencia por workflow+source_event_id
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
    // Si es unique violation, ya existe: skip
    if (ins.error.code === '23505') return { skipped: true };
    // eslint-disable-next-line no-console
    console.error('ensureRun insert failed', ins.error.message);
    throw new Error(ins.error.message);
  }

  const runId = ins.data?.id;
  if (typeof runId !== 'string' || !runId) throw new Error('ensureRun_missing_id');

  return { runId };
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
  // 1) Leer labels actuales
  const sel = await admin
    .from('leads')
    .select('labels')
    .eq('workspace_id', args.workspaceId)
    .eq('id', args.leadId)
    .maybeSingle();

  if (sel.error) throw new Error(sel.error.message);

  const cur = sel.data?.labels;
  const labels: string[] = Array.isArray(cur) ? cur.filter((x): x is string => typeof x === 'string') : [];
  const normalized = args.label.trim();

  if (!normalized) return;
  if (labels.includes(normalized)) return; // idempotente

  const next = [...labels, normalized];

  const upd = await admin.from('leads').update({ labels: next }).eq('workspace_id', args.workspaceId).eq('id', args.leadId);

  if (upd.error) throw new Error(upd.error.message);
}

async function findMatchingWorkflows(
  admin: SupabaseClient,
  args: { workspaceId: string; event: QueueRow }
): Promise<string[]> {
  // MVP: workflow “match” = tiene un nodo trigger con config.event === event_type (y opcional toStageId)
  const wfRes = await admin
    .from('workflows')
    .select('id, workspace_id, name, status')
    .eq('workspace_id', args.workspaceId)
    .eq('status', 'active');

  if (wfRes.error) throw new Error(wfRes.error.message);

  const workflows = (wfRes.data ?? []) as WorkflowRow[];
  if (workflows.length === 0) return [];

  const wfIds = workflows.map((w) => w.id);

  const nodesRes = await admin
    .from('workflow_nodes')
    .select('id, workflow_id, type, name, config')
    .in('workflow_id', wfIds)
    .eq('type', 'trigger');

  if (nodesRes.error) throw new Error(nodesRes.error.message);

  const trigNodes = (nodesRes.data ?? []) as NodeRow[];
  const toStageId = payloadToStageId(args.event.payload);

  const matched = new Set<string>();
  for (const n of trigNodes) {
    if (!isTriggerConfig(n.config)) continue;
    if (n.config.event !== args.event.event_type) continue;

    // filtro opcional
    if (typeof n.config.toStageId === 'string' && n.config.toStageId.trim()) {
      if (!toStageId || n.config.toStageId !== toStageId) continue;
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
    nodes: (nRes.data ?? []) as NodeRow[],
    edges: (eRes.data ?? []) as EdgeRow[],
  };
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // ✅ protección simple para cron/runner
    const secret = getEnv('KALUE_CRON_SECRET');
    const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!got || got !== secret) return json(401, { ok: false, error: 'unauthorized' });

    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1) Claim eventos
    const claim = await admin.rpc('claim_workflow_events', { p_limit: 10 });
    if (claim.error) return json(500, { ok: false, error: 'db_error', detail: claim.error.message });

    const events = (claim.data ?? []) as QueueRow[];
    if (events.length === 0) return json(200, { ok: true, processed: 0 });

    let processed = 0;

    for (const ev of events) {
      try {
        // Solo MVP: lead.stage_changed
        if (ev.event_type !== 'lead.stage_changed') {
          await markProcessed(admin, ev.id);
          processed += 1;
          continue;
        }

        const wfIds = await findMatchingWorkflows(admin, { workspaceId: ev.workspace_id, event: ev });

        // no match => procesado (no reintentar)
        if (wfIds.length === 0) {
          await markProcessed(admin, ev.id);
          processed += 1;
          continue;
        }

        // Ejecuta cada workflow match (MVP: 1 trigger -> 1 acción add_label)
        for (const workflowId of wfIds) {
          const wfRes = await admin.from('workflows').select('id, workspace_id, name, status').eq('id', workflowId).single();
          if (wfRes.error) throw new Error(wfRes.error.message);
          const wf = wfRes.data as WorkflowRow;

          const run = await ensureRun(admin, {
            workflow: wf,
            event: ev,
            entityType: 'lead',
            entityId: ev.entity_id,
            actorUserId: payloadActor(ev.payload),
          });

          // ✅ TS-safe: si ya existe por idempotencia, skip
          if ('skipped' in run) continue;
          const runId = run.runId;

          const graph = await loadGraph(admin, workflowId);

          // Encuentra triggers que match y sus edges a acciones
          const triggers = graph.nodes.filter(
            (n) => n.type === 'trigger' && isTriggerConfig(n.config) && n.config.event === 'lead.stage_changed'
          );
          const nodeById = new Map<string, NodeRow>();
          for (const n of graph.nodes) nodeById.set(n.id, n);

          let ranAny = false;

          for (const t of triggers) {
            // filtro opcional por toStageId
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

              // MVP: solo add_label
              if (isActionAddLabelConfig(target.config)) {
                await execAddLabel(admin, { workspaceId: ev.workspace_id, leadId: ev.entity_id, label: target.config.label });
                ranAny = true;
              }
            }
          }

          await finishRun(admin, {
            runId,
            status: 'completed',
            error: ranAny ? null : 'no_action_executed',
          });
        }

        // Evento procesado
        await markProcessed(admin, ev.id);
        processed += 1;
      } catch (err: unknown) {
        // Mantener evento para reintento: unlock
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
