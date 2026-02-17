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

async function getAuthedUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

async function isWorkspaceMember(args: { admin: SupabaseClient; workspaceId: string; userId: string }): Promise<boolean> {
  const { data, error } = await args.admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', args.workspaceId)
    .eq('user_id', args.userId)
    .limit(1);

  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

type StageRow = {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
};

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
    const stageId = pickString(body, 'stageId');
    const toStageId = pickString(body, 'toStageId');

    if (!stageId) return json(400, { ok: false, error: 'missing_stageId' });
    if (!toStageId) return json(400, { ok: false, error: 'missing_toStageId' });
    if (stageId === toStageId) return json(400, { ok: false, error: 'toStageId_must_be_different' });

    // Auth user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const userId = await getAuthedUserId(userClient);
    if (!userId) return json(401, { ok: false, error: 'login_required' });

    // Admin
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const ok = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!ok) return json(403, { ok: false, error: 'not_member' });

    // Leer stage origen y destino
    const { data: fromSt, error: fromErr } = await admin
      .from('pipeline_stages')
      .select('id, pipeline_id, name, sort_order')
      .eq('id', stageId)
      .maybeSingle();

    if (fromErr) return json(500, { ok: false, error: 'db_error', detail: fromErr.message });
    if (!fromSt) return json(404, { ok: false, error: 'stage_not_found' });

    const { data: toSt, error: toErr } = await admin
      .from('pipeline_stages')
      .select('id, pipeline_id, name, sort_order')
      .eq('id', toStageId)
      .maybeSingle();

    if (toErr) return json(500, { ok: false, error: 'db_error', detail: toErr.message });
    if (!toSt) return json(404, { ok: false, error: 'to_stage_not_found' });

    if (fromSt.pipeline_id !== toSt.pipeline_id) {
      return json(400, { ok: false, error: 'stages_must_belong_to_same_pipeline' });
    }

    const pipelineId = fromSt.pipeline_id;

    // Verificar pipeline pertenece al workspace
    const { data: p, error: pErr } = await admin
      .from('pipelines')
      .select('id')
      .eq('id', pipelineId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (pErr) return json(500, { ok: false, error: 'db_error', detail: pErr.message });
    if (!p) return json(403, { ok: false, error: 'forbidden' });

    // Mover leads de stageId -> toStageId
    const nowIso = new Date().toISOString();
    const { error: moveErr } = await admin
      .from('lead_pipeline_state')
      .update({ stage_id: toStageId, stage_changed_at: nowIso, updated_at: nowIso })
      .eq('workspace_id', workspaceId)
      .eq('pipeline_id', pipelineId)
      .eq('stage_id', stageId);

    if (moveErr) return json(500, { ok: false, error: 'db_error', detail: moveErr.message });

    // Borrar stage
    const { error: delErr } = await admin.from('pipeline_stages').delete().eq('id', stageId);
    if (delErr) return json(500, { ok: false, error: 'db_error', detail: delErr.message });

    // Re-normalizar sort_order (0..n-1)
    const { data: remainingRaw, error: remErr } = await admin
      .from('pipeline_stages')
      .select('id, pipeline_id, name, sort_order')
      .eq('pipeline_id', pipelineId)
      .order('sort_order', { ascending: true });

    if (remErr) return json(500, { ok: false, error: 'db_error', detail: remErr.message });

    const remaining = (Array.isArray(remainingRaw) ? remainingRaw : []) as unknown as StageRow[];
    for (let i = 0; i < remaining.length; i += 1) {
      const s = remaining[i];
      if (!s) continue;
      if (s.sort_order !== i) {
        const { error: upErr } = await admin.from('pipeline_stages').update({ sort_order: i }).eq('id', s.id);
        if (upErr) return json(500, { ok: false, error: 'db_error', detail: upErr.message });
      }
    }

    return json(200, { ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
