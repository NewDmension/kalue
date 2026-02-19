// src/lib/api/authWorkspace.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type AuthedContext = {
  workspaceId: string;
  userId: string;
  admin: SupabaseClient;
};

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getBearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

export function jsonError(status: number, error: string, detail?: string) {
  return new Response(JSON.stringify({ ok: false, error, detail }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function requireAuthedWorkspace(req: Request): Promise<AuthedContext | Response> {
  const token = getBearer(req);
  if (!token) return jsonError(401, 'login_required');

  const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
  if (!workspaceId) return jsonError(400, 'missing_workspace_id');

  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) return jsonError(401, 'login_required');

  const userId = data.user.id;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: member, error: memErr } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .limit(1);

  if (memErr) return jsonError(500, 'membership_check_failed', memErr.message);
  if (!Array.isArray(member) || member.length === 0) return jsonError(403, 'not_member');

  return { workspaceId, userId, admin };
}
