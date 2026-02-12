// src/app/api/integrations/list/route.ts
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

function pickErrMeta(err: unknown): { detail?: string; hint?: string; code?: string } {
  const e = err as { message?: unknown; hint?: unknown; details?: unknown; code?: unknown };
  const detail =
    typeof e?.details === 'string'
      ? e.details
      : typeof e?.message === 'string'
        ? e.message
        : undefined;

  const hint = typeof e?.hint === 'string' ? e.hint : undefined;
  const code = typeof e?.code === 'string' ? e.code : undefined;

  return { detail, hint, code };
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

    const { data, error } = await admin
      .schema('public')
      .from('integrations')
      .select('id, provider, name, status, created_at, connected_at, updated_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      const meta = pickErrMeta(error);
      return json(500, { error: 'db_error', ...meta });
    }

    return json(200, { ok: true, integrations: data ?? [] });
  } catch (e: unknown) {
    const meta = pickErrMeta(e);
    const detail = meta.detail ?? (e instanceof Error ? e.message : 'Unexpected error');
    return json(500, { error: 'server_error', ...meta, detail });
  }
}
