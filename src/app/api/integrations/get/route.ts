import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getBearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
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

function getQueryParam(req: Request, name: string): string {
  const url = new URL(req.url);
  return url.searchParams.get(name) ?? '';
}

export async function GET(req: Request) {
  try {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearer(req);
    if (!token) return json(401, { error: 'login_required' });

    const workspaceId = req.headers.get('x-workspace-id');
    if (!workspaceId) return json(400, { error: 'missing_workspace_id' });

    const integrationId = getQueryParam(req, 'integrationId').trim();
    if (!integrationId) return json(400, { error: 'missing_integration_id' });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const userId = await getAuthedUserId(userClient);
    if (!userId) return json(401, { error: 'login_required' });

    const admin = createClient(supabaseUrl, serviceKey);

    const ok = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!ok) return json(403, { error: 'not_member' });

    const { data, error } = await admin
      .from('integrations')
      .select('id, workspace_id, provider, name, status, created_at, config, secrets')
      .eq('workspace_id', workspaceId)
      .eq('id', integrationId)
      .limit(1)
      .maybeSingle();

    if (error) return json(500, { error: 'db_error', detail: error.message });
    if (!data) return json(404, { error: 'not_found' });

    // IMPORTANTE: normalmente NO devolverías "secrets" al frontend.
    // Lo dejo aquí porque tú estás en fase debug. Luego lo quitamos.
    return json(200, { ok: true, integration: data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    return json(500, { error: 'server_error', detail: msg });
  }
}
