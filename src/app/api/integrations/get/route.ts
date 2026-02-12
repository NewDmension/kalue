// src/app/api/integrations/get/route.ts
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
    .schema('public')
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

    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!workspaceId) return json(400, { error: 'missing_workspace_id' });
    if (!isUuid(workspaceId)) return json(400, { error: 'invalid_workspace_id' });

    const rawId = getQueryParam(req, 'integrationId').trim();
    const low = rawId.toLowerCase();

    if (!rawId || low === 'undefined' || low === 'null' || !isUuid(rawId)) {
      return json(400, { error: 'invalid_integration_id', detail: `received: ${rawId || '(empty)'}` });
    }

    const debug = getQueryParam(req, 'debug') === '1';

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const userId = await getAuthedUserId(userClient);
    if (!userId) return json(401, { error: 'login_required' });

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ok = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!ok) return json(403, { error: 'not_member' });

    // 👇 Devolvemos connected_at + updated_at para depurar el "DRAFT"
    const selectBase =
      'id, workspace_id, provider, name, status, created_at, connected_at, updated_at, config';

    const select = debug ? `${selectBase}, secrets` : selectBase;

    const { data, error } = await admin
      .schema('public')
      .from('integrations')
      .select(select)
      .eq('workspace_id', workspaceId)
      .eq('id', rawId)
      .limit(1)
      .maybeSingle();

    if (error) return json(500, { error: 'db_error', detail: error.message });
    if (!data) return json(404, { error: 'not_found' });

    return json(200, { ok: true, integration: data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    return json(500, { error: 'server_error', detail: msg });
  }
}
