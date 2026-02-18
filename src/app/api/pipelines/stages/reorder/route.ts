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

function pickStringArray(v: unknown, key: string): string[] {
  if (!isRecord(v)) return [];
  const x = v[key];
  if (!Array.isArray(x)) return [];
  const out: string[] = [];
  for (const item of x) {
    if (typeof item === 'string' && item.trim()) out.push(item.trim());
  }
  return out;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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

type StageMinRow = { id: string; pipeline_id: string };

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
    const stageIds = pickStringArray(body, 'stageIds');

    if (!pipelineId) return json(400, { ok: false, error: 'missing_pipelineId' });
    if (!isUuid(pipelineId)) return json(400, { ok: false, error: 'invalid_pipelineId' });

    if (stageIds.length < 2) return json(400, { ok: false, error: 'stageIds_too_short' });
    for (const id of stageIds) {
      if (!isUuid(id)) return json(400, { ok: false, error: 'invalid_stageIds' });
    }

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

    // Verificar pipeline pertenece al workspace
    const { data: p, error: pErr } = await admin
      .from('pipelines')
      .select('id')
      .eq('id', pipelineId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (pErr) return json(500, { ok: false, error: 'db_error', detail: pErr.message });
    if (!p) return json(404, { ok: false, error: 'pipeline_not_found' });

    // Verificar que los stageIds pertenecen a ese pipeline (y que no falte ninguno)
    const { data: rowsRaw, error: sErr } = await admin
      .from('pipeline_stages')
      .select('id, pipeline_id')
      .in('id', stageIds)
      .limit(stageIds.length);

    if (sErr) return json(500, { ok: false, error: 'db_error', detail: sErr.message });

    const rows = (Array.isArray(rowsRaw) ? rowsRaw : []) as unknown as StageMinRow[];
    if (rows.length !== stageIds.length) return json(400, { ok: false, error: 'stageIds_mismatch' });
    for (const r of rows) {
      if (r.pipeline_id !== pipelineId) return json(400, { ok: false, error: 'stages_must_belong_to_pipeline' });
    }

    const { error: rpcErr } = await admin.rpc('reorder_pipeline_stages', {
      p_pipeline_id: pipelineId,
      p_stage_ids: stageIds,
    });

    if (rpcErr) return json(500, { ok: false, error: 'db_error', detail: rpcErr.message });

    return json(200, { ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
