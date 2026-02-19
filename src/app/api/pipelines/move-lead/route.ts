// src/app/api/pipelines/move-lead/route.ts
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

function getBearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

async function safeJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function pickString(v: unknown, key: string): string {
  if (!isRecord(v)) return '';
  const x = v[key];
  return typeof x === 'string' ? x.trim() : '';
}

function pickInt(v: unknown, key: string): number | null {
  if (!isRecord(v)) return null;
  const x = v[key];
  if (typeof x === 'number' && Number.isFinite(x)) return Math.trunc(x);
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

async function getAuthedUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

async function isWorkspaceMember(args: {
  admin: SupabaseClient;
  workspaceId: string;
  userId: string;
}): Promise<boolean> {
  const { data, error } = await args.admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', args.workspaceId)
    .eq('user_id', args.userId)
    .limit(1);

  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

async function pipelineBelongsToWorkspace(args: {
  admin: SupabaseClient;
  workspaceId: string;
  pipelineId: string;
}): Promise<boolean> {
  const { data, error } = await args.admin
    .from('pipelines')
    .select('id')
    .eq('id', args.pipelineId)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle();

  if (error) return false;
  return Boolean(data?.id);
}

async function readPrevLeadState(args: {
  admin: SupabaseClient;
  workspaceId: string;
  pipelineId: string;
  leadId: string;
}): Promise<{ stageId: string | null; position: number | null }> {
  const { data, error } = await args.admin
    .from('lead_pipeline_state')
    .select('stage_id, position')
    .eq('workspace_id', args.workspaceId)
    .eq('pipeline_id', args.pipelineId)
    .eq('lead_id', args.leadId)
    .maybeSingle();

  if (error) {
    // Si falla la lectura, no rompemos el move. Devolvemos nulls.
    return { stageId: null, position: null };
  }

  const stageId = typeof data?.stage_id === 'string' ? data.stage_id : null;
  const position = typeof data?.position === 'number' && Number.isFinite(data.position) ? data.position : null;

  return { stageId, position };
}

async function tryMoveLead(args: {
  admin: SupabaseClient;
  workspaceId: string;
  pipelineId: string;
  leadId: string;
  toStageId: string;
  toPosition: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await args.admin.rpc('move_lead_in_pipeline', {
    p_workspace_id: args.workspaceId,
    p_pipeline_id: args.pipelineId,
    p_lead_id: args.leadId,
    p_to_stage_id: args.toStageId,
    p_to_position: Math.max(0, args.toPosition),
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

async function rebalanceStage(args: {
  admin: SupabaseClient;
  workspaceId: string;
  pipelineId: string;
  stageId: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await args.admin.rpc('rebalance_stage_positions', {
    p_workspace_id: args.workspaceId,
    p_pipeline_id: args.pipelineId,
    p_stage_id: args.stageId,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | { [k: string]: JsonValue } | JsonValue[];

async function enqueueWorkflowEvent(args: {
  admin: SupabaseClient;
  workspaceId: string;
  eventType: string;
  entityId: string;
  payload: Record<string, JsonValue>;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await args.admin.from('workflow_event_queue').insert({
    workspace_id: args.workspaceId,
    event_type: args.eventType,
    entity_id: args.entityId,
    payload: args.payload,
  });

  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearer(req);
    if (!token) return json(401, { ok: false, error: 'login_required' });

    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!workspaceId) return json(400, { ok: false, error: 'missing_workspace_id' });

    const body = await safeJson(req);

    const pipelineId = pickString(body, 'pipelineId');
    const leadId = pickString(body, 'leadId');
    const toStageId = pickString(body, 'toStageId');
    const toPosition = pickInt(body, 'toPosition');

    if (!pipelineId) return json(400, { ok: false, error: 'missing_pipelineId' });
    if (!leadId) return json(400, { ok: false, error: 'missing_leadId' });
    if (!toStageId) return json(400, { ok: false, error: 'missing_toStageId' });
    if (toPosition === null) return json(400, { ok: false, error: 'missing_toPosition' });

    // Auth user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const userId = await getAuthedUserId(userClient);
    if (!userId) return json(401, { ok: false, error: 'login_required' });

    // Admin (service role)
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const member = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!member) return json(403, { ok: false, error: 'not_member' });

    const pipelineOk = await pipelineBelongsToWorkspace({ admin, workspaceId, pipelineId });
    if (!pipelineOk) return json(404, { ok: false, error: 'pipeline_not_found' });

    // Leer estado previo para evento (no bloqueante)
    const prev = await readPrevLeadState({ admin, workspaceId, pipelineId, leadId });

    // 1) Intento normal
    const first = await tryMoveLead({
      admin,
      workspaceId,
      pipelineId,
      leadId,
      toStageId,
      toPosition,
    });

    let movedOk = first.ok;

    // 2) Fallback: rebalance del stage destino y reintento 1 vez
    if (!movedOk) {
      const reb = await rebalanceStage({
        admin,
        workspaceId,
        pipelineId,
        stageId: toStageId,
      });

      if (!reb.ok) {
        return json(500, { ok: false, error: 'db_error', detail: `rebalance_failed: ${reb.message}` });
      }

      const second = await tryMoveLead({
        admin,
        workspaceId,
        pipelineId,
        leadId,
        toStageId,
        toPosition,
      });

      if (!second.ok) {
        return json(500, {
          ok: false,
          error: 'db_error',
          detail: `move_failed_after_rebalance: ${second.message}`,
        });
      }

      movedOk = true;
    }

    // Si hemos llegado aquí, el move ha ido OK.
    // Encolamos evento para automatizaciones (NO rompe el move si falla)
    const occurredAt = new Date().toISOString();

    const ev = await enqueueWorkflowEvent({
      admin,
      workspaceId,
      eventType: 'lead.stage_changed',
      entityId: leadId,
      payload: {
        pipelineId,
        fromStageId: prev.stageId,
        toStageId,
        fromPosition: prev.position,
        toPosition: Math.max(0, toPosition),
        actorUserId: userId,
        occurredAt,
      },
    });

    if (!ev.ok) {
      return json(200, { ok: true, warning: `event_enqueue_failed:${ev.message}` });
    }

    return json(200, { ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
