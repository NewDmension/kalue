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

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

async function safeJson(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function supabaseAdmin(): SupabaseClient {
  const url = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireUserId(admin: SupabaseClient, accessToken: string): Promise<string | null> {
  const { data, error } = await admin.auth.getUser(accessToken);
  if (error) return null;
  return data.user?.id ?? null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const token = getBearer(req);
  if (!token) return json(401, { ok: false, error: 'missing_bearer' });

  const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
  if (!workspaceId) return json(400, { ok: false, error: 'missing_workspace' });
  if (!isUuid(workspaceId)) return json(400, { ok: false, error: 'invalid_workspace' });

  const body = await safeJson(req);
  if (!isRecord(body)) return json(400, { ok: false, error: 'invalid_json' });

  const leadIdRaw = body.lead_id;
  const leadId = typeof leadIdRaw === 'string' ? leadIdRaw.trim() : '';
  if (!leadId) return json(400, { ok: false, error: 'missing_lead_id' });
  if (!isUuid(leadId)) return json(400, { ok: false, error: 'invalid_lead_id' });

  const admin = supabaseAdmin();

  // valida sesión (aunque luego no uses userId, esto evita llamadas anónimas)
  const userId = await requireUserId(admin, token);
  if (!userId) return json(401, { ok: false, error: 'invalid_session' });

  // idempotente: solo actualiza las que estén sin leer
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from('lead_notifications')
    .update({ read_at: nowIso })
    .eq('workspace_id', workspaceId)
    .eq('lead_id', leadId)
    .is('read_at', null)
    .select('id');

  if (error) return json(500, { ok: false, error: 'db_update_failed', detail: error.message });

  const updated = Array.isArray(data) ? data.length : 0;
  return json(200, { ok: true, updated });
}
