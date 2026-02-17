import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LeadNotificationRow = {
  id: string;
  workspace_id: string;
  lead_id: string;
  kind: string;
  title: string | null;
  message: string | null;
  created_at: string;
  read_at: string | null;
};

type LeadNotificationItem = {
  id: string;
  created_at: string;
  lead_id: string;
  kind: string;
  title: string | null;
  message: string | null;
};

type OkResponse = { ok: true; unreadCount: number; items: LeadNotificationItem[] };
type ErrResponse = { ok: false; error: string };

function json(status: number, payload: OkResponse | ErrResponse): NextResponse {
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

function safeInt(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const token = getBearer(req);
    if (!token) return json(401, { ok: false, error: 'missing_token' });

    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!workspaceId) return json(400, { ok: false, error: 'missing_workspace_id' });

    const url = new URL(req.url);
    const unread = (url.searchParams.get('unread') ?? '').trim() === '1';
    const limit = Math.min(500, Math.max(1, safeInt(url.searchParams.get('limit'), 100)));

    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const serviceRole = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const sb: SupabaseClient = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false },
    });

    // valida sesión del usuario (token real)
    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData.user) return json(401, { ok: false, error: 'invalid_token' });

    let q = sb
      .from('lead_notifications')
      .select('id, workspace_id, lead_id, kind, title, message, created_at, read_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (unread) q = q.is('read_at', null);

    const { data, error } = await q;
    if (error) return json(500, { ok: false, error: 'db_error' });

    const rows = (data ?? []) as LeadNotificationRow[];

    const items: LeadNotificationItem[] = rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      lead_id: r.lead_id,
      kind: r.kind,
      title: r.title,
      message: r.message,
    }));

    if (unread) return json(200, { ok: true, unreadCount: items.length, items });

    const { count, error: countErr } = await sb
      .from('lead_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .is('read_at', null);

    if (countErr) return json(200, { ok: true, unreadCount: 0, items });

    return json(200, { ok: true, unreadCount: count ?? 0, items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error';
    return json(500, { ok: false, error: msg });
  }
}
