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

type PipelineRow = {
  id: string;
  name: string;
};

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearer(req);
    if (!token) return json(401, { ok: false, error: 'login_required' });

    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!workspaceId) return json(400, { ok: false, error: 'missing_workspace_id' });

    // user client para validar sesión
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const userId = await getAuthedUserId(userClient);
    if (!userId) return json(401, { ok: false, error: 'login_required' });

    // admin client
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const member = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!member) return json(403, { ok: false, error: 'not_member' });

    const { data, error } = await admin
      .from('pipelines')
      .select('id,name')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });

    if (error) return json(500, { ok: false, error: 'db_error', detail: error.message });

    const pipelines: PipelineRow[] = Array.isArray(data)
      ? data
          .map((r) => ({
            id: typeof (r as { id?: unknown }).id === 'string' ? (r as { id: string }).id : '',
            name: typeof (r as { name?: unknown }).name === 'string' ? (r as { name: string }).name : '',
          }))
          .filter((p) => p.id && p.name)
      : [];

    return json(200, { ok: true, pipelines });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
