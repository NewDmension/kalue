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
  color: string | null;
  is_won: boolean;
  is_lost: boolean;
  created_at: string;
  updated_at: string;
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
    const pipelineId = pickString(body, 'pipelineId');
    const name = pickString(body, 'name');

    if (!pipelineId) return json(400, { ok: false, error: 'missing_pipelineId' });
    if (!name) return json(400, { ok: false, error: 'missing_name' });
    if (name.length > 80) return json(400, { ok: false, error: 'name_too_long' });

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

    // sort_order = max + 1
    const { data: lastStage, error: lastErr } = await admin
      .from('pipeline_stages')
      .select('sort_order')
      .eq('pipeline_id', pipelineId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastErr) return json(500, { ok: false, error: 'db_error', detail: lastErr.message });

    const maxSort = typeof lastStage?.sort_order === 'number' ? lastStage.sort_order : -1;
    const nextSort = maxSort + 1;

    const { data: inserted, error: insErr } = await admin
      .from('pipeline_stages')
      .insert({
        pipeline_id: pipelineId,
        name,
        sort_order: nextSort,
        color: null,
        is_won: false,
        is_lost: false,
      })
      .select('id, pipeline_id, name, sort_order, color, is_won, is_lost, created_at, updated_at')
      .maybeSingle();

    if (insErr) return json(500, { ok: false, error: 'db_error', detail: insErr.message });
    if (!inserted) return json(500, { ok: false, error: 'insert_failed' });

    return json(200, { ok: true, stage: inserted as unknown as StageRow });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
