// src/app/api/integrations/meta/leads/sync/route.ts
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { decryptToken } from '@/server/crypto/tokenCrypto';

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

function pickNumber(v: unknown, key: string, fallback: number): number {
  if (!isRecord(v)) return fallback;
  const x = v[key];
  if (typeof x === 'number' && Number.isFinite(x)) return Math.max(1, Math.trunc(x));
  if (typeof x === 'string') {
    const n = Number.parseInt(x.trim(), 10);
    return Number.isFinite(n) ? Math.max(1, Math.trunc(n)) : fallback;
  }
  return fallback;
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

async function graphGet(url: string, accessToken: string): Promise<{ ok: boolean; status: number; raw: unknown }> {
  const res = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  const text = await res.text();
  let raw: unknown = null;
  try {
    raw = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    raw = { _nonJson: true, text };
  }

  return { ok: res.ok, status: res.status, raw };
}

type AccountsItem = { id?: unknown; access_token?: unknown; name?: unknown };
type AccountsResp = { data?: AccountsItem[]; error?: unknown };

async function getUserAccessToken(args: {
  admin: SupabaseClient;
  workspaceId: string;
  integrationId: string;
}): Promise<string> {
  const { data, error } = await args.admin
    .from('integration_oauth_tokens')
    .select('access_token_ciphertext')
    .eq('workspace_id', args.workspaceId)
    .eq('integration_id', args.integrationId)
    .eq('provider', 'meta')
    .maybeSingle();

  if (error) throw new Error(`db_error: ${error.message}`);
  if (!data?.access_token_ciphertext) throw new Error('token_not_found');
  return decryptToken(data.access_token_ciphertext);
}

async function getPageAccessToken(args: {
  graphVersion: string;
  userAccessToken: string;
  pageId: string;
}): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${args.graphVersion}/me/accounts`);
  url.searchParams.set('fields', 'id,access_token');
  url.searchParams.set('limit', '200');

  const r = await graphGet(url.toString(), args.userAccessToken);
  if (!r.ok) throw new Error('graph_error_me_accounts');

  const parsed = (isRecord(r.raw) ? (r.raw as AccountsResp) : {}) as AccountsResp;
  const arr = Array.isArray(parsed.data) ? parsed.data : [];

  for (const it of arr) {
    const id = typeof it.id === 'string' ? it.id : '';
    if (id !== args.pageId) continue;
    const token = typeof it.access_token === 'string' ? it.access_token : '';
    if (!token) throw new Error('page_token_missing');
    return token;
  }

  throw new Error('page_not_found_in_me_accounts');
}

type LeadsItem = { id?: unknown; created_time?: unknown; field_data?: unknown };
type LeadsResp = { data?: LeadsItem[]; error?: unknown };

function normalizeLeadRows(raw: unknown): Array<{ leadId: string; createdTime: string | null; raw: unknown }> {
  const parsed = (isRecord(raw) ? (raw as LeadsResp) : {}) as LeadsResp;
  const arr = Array.isArray(parsed.data) ? parsed.data : [];
  const out: Array<{ leadId: string; createdTime: string | null; raw: unknown }> = [];

  for (const it of arr) {
    const id = typeof it.id === 'string' ? it.id : '';
    const created = typeof it.created_time === 'string' ? it.created_time : null;
    if (id) out.push({ leadId: id, createdTime: created, raw: it });
  }

  return out;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearer(req);
    if (!token) return json(401, { error: 'login_required' });

    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!workspaceId) return json(400, { error: 'missing_workspace_id' });

    const body = await safeJson(req);
    const integrationId = pickString(body, 'integrationId');
    const limit = pickNumber(body, 'limit', 25);

    if (!integrationId) return json(400, { error: 'missing_integrationId' });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const userId = await getAuthedUserId(userClient);
    if (!userId) return json(401, { error: 'login_required' });

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const ok = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!ok) return json(403, { error: 'not_member' });

    // Necesitamos mapping activo
    const { data: mapping, error: mapErr } = await admin
      .from('integration_meta_mappings')
      .select('page_id, form_id, status')
      .eq('integration_id', integrationId)
      .maybeSingle();

    if (mapErr) return json(500, { error: 'db_error', detail: mapErr.message });
    if (!mapping?.page_id || !mapping.form_id) return json(400, { error: 'mapping_incomplete', detail: 'Missing page_id or form_id' });

    const pageId = String(mapping.page_id);
    const formId = String(mapping.form_id);

    const graphVersion = (process.env.META_GRAPH_VERSION?.trim() || 'v20.0').replace(/^v/i, 'v');
    const userAccessToken = await getUserAccessToken({ admin, workspaceId, integrationId });
    const pageToken = await getPageAccessToken({ graphVersion, userAccessToken, pageId });

    // Pull leads
    const leadsUrl = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(formId)}/leads`);
    leadsUrl.searchParams.set('fields', 'id,created_time,field_data');
    leadsUrl.searchParams.set('limit', String(Math.min(200, Math.max(1, limit))));

    const r = await graphGet(leadsUrl.toString(), pageToken);
    if (!r.ok) return json(r.status, { error: 'graph_error', where: 'form/leads', raw: r.raw });

    const rows = normalizeLeadRows(r.raw);

    let inserted = 0;
    for (const row of rows) {
      const { error: insErr } = await admin.from('integration_leads').insert({
        provider: 'meta',
        workspace_id: workspaceId,
        integration_id: integrationId,
        page_id: pageId,
        form_id: formId,
        lead_id: row.leadId,
        created_time: row.createdTime,
        raw: row.raw,
      });

      // unique constraint: si ya existe, lo ignoramos
      if (!insErr) inserted += 1;
    }

    await admin
      .from('integration_meta_mappings')
      .update({ last_sync_at: new Date().toISOString(), last_error: null })
      .eq('integration_id', integrationId);

    return json(200, { ok: true, fetched: rows.length, inserted });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { error: 'server_error', detail: msg });
  }
}
