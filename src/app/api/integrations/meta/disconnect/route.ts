import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickString(v: unknown, key: string): string {
  if (!isRecord(v)) return '';
  const x = v[key];
  return typeof x === 'string' ? x : '';
}

function getBearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function getWorkspaceId(req: Request): string {
  const v = (req.headers.get('x-workspace-id') ?? '').trim();
  if (!v) throw new Error('Missing x-workspace-id header');
  return v;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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

async function getAuthedUserId(args: { supabaseUrl: string; anonKey: string; token: string }): Promise<string | null> {
  const userClient = createClient(args.supabaseUrl, args.anonKey, {
    global: { headers: { Authorization: `Bearer ${args.token}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearer(req);
    if (!token) return json(401, { error: 'login_required' });

    const workspaceId = getWorkspaceId(req);
    if (!isUuid(workspaceId)) return json(400, { error: 'invalid_workspace_id' });

    const body = await safeJson(req);
    const integrationId = pickString(body, 'integrationId').trim();
    if (!integrationId) return json(400, { error: 'missing_integration_id' });
    if (!isUuid(integrationId)) return json(400, { error: 'invalid_integration_id' });

    const userId = await getAuthedUserId({ supabaseUrl, anonKey, token });
    if (!userId) return json(401, { error: 'login_required' });

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // membership check
    const { data: member, error: memErr } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (memErr) return json(500, { error: 'db_error', detail: memErr.message });
    if (!member) return json(403, { error: 'not_member' });

    // ensure integration exists and provider=meta
    const { data: integ, error: integErr } = await admin
      .from('integrations')
      .select('id, provider')
      .eq('workspace_id', workspaceId)
      .eq('id', integrationId)
      .maybeSingle();

    if (integErr) return json(500, { error: 'db_error', detail: integErr.message });
    if (!integ) return json(404, { error: 'integration_not_found' });
    if (integ.provider !== 'meta') return json(400, { error: 'wrong_provider' });

    // delete token
    const { error: delErr } = await admin
      .from('integration_oauth_tokens')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('integration_id', integrationId)
      .eq('provider', 'meta');

    if (delErr) return json(500, { error: 'db_error', detail: delErr.message });

    // set integration status to draft
    const { error: updErr } = await admin
      .from('integrations')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', integrationId);

    if (updErr) return json(500, { error: 'db_error', detail: updErr.message });

    return json(200, { ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    return json(400, { error: msg });
  }
}
