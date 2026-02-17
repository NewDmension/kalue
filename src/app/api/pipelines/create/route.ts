// src/app/api/pipelines/create/route.ts
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
  created_at: string;
  updated_at: string;
};

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearer(req);
    if (!token) return json(401, { error: 'login_required' });

    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!workspaceId) return json(400, { error: 'missing_workspace_id' });

    const body = await safeJson(req);
    const name = pickString(body, 'name');
    if (!name) return json(400, { error: 'missing_name' });
    if (name.length > 80) return json(400, { error: 'name_too_long' });

    // Auth user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const userId = await getAuthedUserId(userClient);
    if (!userId) return json(401, { error: 'login_required' });

    // Admin
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ok = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!ok) return json(403, { error: 'not_member' });

    // Llamar a tu RPC (ya creada)
    // Nota: en supabase-js, cuando la función retorna uuid, suele venir como string.
    const { data: rpcData, error: rpcError } = await admin.rpc('create_pipeline_with_default_stages', {
      p_workspace_id: workspaceId,
      p_name: name,
    });

    if (rpcError) {
      return json(500, { error: 'rpc_error', detail: rpcError.message });
    }

    const pipelineId = typeof rpcData === 'string' ? rpcData : null;
    if (!pipelineId) {
      return json(500, { error: 'rpc_bad_return', detail: 'expected uuid string' });
    }

    // Devolver pipeline + stages para pintar UI sin otra llamada
    const { data: pipeline, error: pErr } = await admin
      .from('pipelines')
      .select('id, workspace_id, name, is_default, created_at, updated_at')
      .eq('id', pipelineId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (pErr) return json(500, { error: 'db_error', detail: pErr.message });
    if (!pipeline) return json(404, { error: 'pipeline_not_found' });

    const { data: stages, error: sErr } = await admin
      .from('pipeline_stages')
      .select('id, pipeline_id, name, sort_order, color, is_won, is_lost, created_at, updated_at')
      .eq('pipeline_id', pipelineId)
      .order('sort_order', { ascending: true });

    if (sErr) return json(500, { error: 'db_error', detail: sErr.message });

    return json(200, {
      ok: true,
      pipelineId,
      pipeline: pipeline as unknown as PipelineRow,
      stages: (Array.isArray(stages) ? stages : []) as unknown as StageRow[],
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { error: 'server_error', detail: msg });
  }
}
