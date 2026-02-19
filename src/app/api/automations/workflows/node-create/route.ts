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

function pickNumber(v: unknown, key: string): number | null {
  if (!isRecord(v)) return null;
  const x = v[key];
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  return null;
}

function mkUserClient(supabaseUrl: string, anonKey: string, token: string): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function mkAdmin(supabaseUrl: string, serviceKey: string): SupabaseClient {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getAuthedUserId(userClient: SupabaseClient): Promise<string | null> {
  const { data, error } = await userClient.auth.getUser();
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

async function workflowBelongsToWorkspace(args: {
  admin: SupabaseClient;
  workspaceId: string;
  workflowId: string;
}): Promise<boolean> {
  const { data, error } = await args.admin
    .from('workflows')
    .select('id')
    .eq('id', args.workflowId)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle();

  if (error) return false;
  return Boolean(data?.id);
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

    const workflowId = pickString(body, 'workflowId');
    const type = pickString(body, 'type');
    const name = pickString(body, 'name');
    const x = pickNumber(body, 'x');
    const y = pickNumber(body, 'y');

    if (!workflowId) return json(400, { ok: false, error: 'missing_workflowId' });
    if (!type) return json(400, { ok: false, error: 'missing_type' });
    if (!name) return json(400, { ok: false, error: 'missing_name' });
    if (x === null || y === null) return json(400, { ok: false, error: 'missing_xy' });

    // Auth user
    const userClient = mkUserClient(supabaseUrl, anonKey, token);
    const userId = await getAuthedUserId(userClient);
    if (!userId) return json(401, { ok: false, error: 'login_required' });

    // Admin (service role)
    const admin = mkAdmin(supabaseUrl, serviceKey);

    const member = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!member) return json(403, { ok: false, error: 'not_member' });

    const okWf = await workflowBelongsToWorkspace({ admin, workspaceId, workflowId });
    if (!okWf) return json(404, { ok: false, error: 'workflow_not_found' });

    // ✅ 1) Insert (no dependemos de RETURNING)
    const ins = await admin
      .from('workflow_nodes')
      .insert({
        workflow_id: workflowId,
        type,
        name,
        config: {},
        ui: { x, y },
      })
      .select('id')
      .single();

    if (ins.error) {
      return json(500, { ok: false, error: 'db_error', detail: ins.error.message });
    }

    const nodeId = ins.data?.id;
    if (!nodeId) {
      return json(500, { ok: false, error: 'db_error', detail: 'insert_no_id' });
    }

    // ✅ 2) Select por id (siempre)
    const sel = await admin
      .from('workflow_nodes')
      .select('id, type, name, config, ui')
      .eq('id', nodeId)
      .single();

    if (sel.error) {
      return json(500, { ok: false, error: 'db_error', detail: sel.error.message });
    }

    return json(200, { ok: true, node: sel.data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
