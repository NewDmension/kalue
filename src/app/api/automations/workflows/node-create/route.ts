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

function pickArray(v: unknown, key: string): unknown[] {
  if (!isRecord(v)) return [];
  const x = v[key];
  return Array.isArray(x) ? x : [];
}

type NodeInput = {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  ui: Record<string, unknown>;
};

type EdgeInput = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  condition_key: string | null;
};

function parseNode(x: unknown): NodeInput | null {
  if (!isRecord(x)) return null;
  const id = typeof x.id === 'string' ? x.id : '';
  const type = typeof x.type === 'string' ? x.type : '';
  const name = typeof x.name === 'string' ? x.name : '';
  const config = isRecord(x.config) ? x.config : {};
  const ui = isRecord(x.ui) ? x.ui : {};
  if (!id || !type || !name) return null;
  return { id, type, name, config, ui };
}

function parseEdge(x: unknown): EdgeInput | null {
  if (!isRecord(x)) return null;
  const id = typeof x.id === 'string' ? x.id : '';
  const from_node_id = typeof x.from_node_id === 'string' ? x.from_node_id : '';
  const to_node_id = typeof x.to_node_id === 'string' ? x.to_node_id : '';
  const condition_key = typeof x.condition_key === 'string' ? x.condition_key : null;
  if (!id || !from_node_id || !to_node_id) return null;
  return { id, from_node_id, to_node_id, condition_key };
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
    if (!workflowId) return json(400, { ok: false, error: 'missing_workflowId' });

    const nodesRaw = pickArray(body, 'nodes');
    const edgesRaw = pickArray(body, 'edges');

    const nodes: NodeInput[] = [];
    for (const n of nodesRaw) {
      const parsed = parseNode(n);
      if (!parsed) return json(400, { ok: false, error: 'invalid_node' });
      nodes.push(parsed);
    }

    const edges: EdgeInput[] = [];
    for (const e of edgesRaw) {
      const parsed = parseEdge(e);
      if (!parsed) return json(400, { ok: false, error: 'invalid_edge' });
      edges.push(parsed);
    }

    // User client (auth)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const userId = await getAuthedUserId(userClient);
    if (!userId) return json(401, { ok: false, error: 'login_required' });

    // Admin (service role)
    const admin = mkAdmin(supabaseUrl, serviceKey);

    const member = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!member) return json(403, { ok: false, error: 'not_member' });

    const okWf = await workflowBelongsToWorkspace({ admin, workspaceId, workflowId });
    if (!okWf) return json(404, { ok: false, error: 'workflow_not_found' });

    // Upsert nodes
    if (nodes.length > 0) {
      const { error } = await admin
        .from('workflow_nodes')
        .upsert(
          nodes.map((n) => ({
            id: n.id,
            workflow_id: workflowId,
            type: n.type,
            name: n.name,
            config: n.config,
            ui: n.ui,
          })),
          { onConflict: 'id' }
        );

      if (error) return json(500, { ok: false, error: 'db_error', detail: error.message });
    }

    // Replace edges MVP: delete + insert
    {
      const { error: delErr } = await admin.from('workflow_edges').delete().eq('workflow_id', workflowId);
      if (delErr) return json(500, { ok: false, error: 'db_error', detail: delErr.message });

      if (edges.length > 0) {
        const { error: insErr } = await admin.from('workflow_edges').insert(
          edges.map((e) => ({
            id: e.id,
            workflow_id: workflowId,
            from_node_id: e.from_node_id,
            to_node_id: e.to_node_id,
            condition_key: e.condition_key,
          }))
        );

        if (insErr) return json(500, { ok: false, error: 'db_error', detail: insErr.message });
      }
    }

    return json(200, { ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
