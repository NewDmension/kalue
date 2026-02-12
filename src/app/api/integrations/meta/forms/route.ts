// src/app/api/integrations/meta/forms/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { decryptToken } from '@/server/crypto/tokenCrypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MetaForm = { id: string; name: string; status?: string | null };

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickString(v: unknown, key: string): string {
  if (!isRecord(v)) return '';
  const x = v[key];
  return typeof x === 'string' ? x : '';
}

function getWorkspaceId(req: Request): string {
  const v = (req.headers.get('x-workspace-id') ?? '').trim();
  if (!v) throw new Error('Missing x-workspace-id header');
  return v;
}

function getQuery(req: Request, name: string): string {
  const url = new URL(req.url);
  return (url.searchParams.get(name) ?? '').trim();
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

type AccountsItem = { id?: unknown; access_token?: unknown; name?: unknown };
type AccountsResp = { data?: AccountsItem[]; error?: unknown };

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

  try {
    return decryptToken(data.access_token_ciphertext);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'decrypt_failed';
    throw new Error(`decrypt_failed: ${msg}`);
  }
}

async function getPageAccessToken(args: {
  graphVersion: string;
  userAccessToken: string;
  pageId: string;
}): Promise<{ pageToken: string; pageName?: string }> {
  // Nota: "perms" ya no existe aquí -> usamos access_token (page token)
  const url = new URL(`https://graph.facebook.com/${args.graphVersion}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token');
  url.searchParams.set('limit', '200');

  const r = await graphGet(url.toString(), args.userAccessToken);
  if (!r.ok) throw new Error(`graph_error_me_accounts`);

  const parsed = (isRecord(r.raw) ? (r.raw as AccountsResp) : {}) as AccountsResp;
  const arr = Array.isArray(parsed.data) ? parsed.data : [];

  for (const it of arr) {
    const id = typeof it.id === 'string' ? it.id : '';
    if (id !== args.pageId) continue;
    const token = typeof it.access_token === 'string' ? it.access_token : '';
    const name = typeof it.name === 'string' ? it.name : undefined;
    if (!token) throw new Error('page_token_missing');
    return { pageToken: token, pageName: name };
  }

  throw new Error('page_not_found_in_me_accounts');
}

type FormsItem = { id?: unknown; name?: unknown; status?: unknown };
type FormsResp = { data?: FormsItem[]; error?: unknown };

function toForms(raw: unknown): MetaForm[] {
  const parsed = (isRecord(raw) ? (raw as FormsResp) : {}) as FormsResp;
  const arr = Array.isArray(parsed.data) ? parsed.data : [];
  const out: MetaForm[] = [];
  for (const f of arr) {
    const id = typeof f.id === 'string' ? f.id : '';
    const name = typeof f.name === 'string' ? f.name : '';
    const status = typeof f.status === 'string' ? f.status : null;
    if (id && name) out.push({ id, name, status });
  }
  return out;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const workspaceId = getWorkspaceId(req);
    const integrationId = getQuery(req, 'integrationId');
    const pageId = getQuery(req, 'pageId');

    if (!integrationId) return json(400, { error: 'missing_integrationId' });
    if (!pageId) return json(400, { error: 'missing_pageId' });

    // Auth user (cookies)
    const cookieStore = await cookies();
    const supabaseServer = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    });

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser();
    if (userErr || !userData.user) return json(401, { error: 'Unauthorized' });

    const userId = userData.user.id;

    // Admin
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const ok = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!ok) return json(403, { error: 'Forbidden' });

    const userAccessToken = await getUserAccessToken({ admin, workspaceId, integrationId });

    const graphVersion = (process.env.META_GRAPH_VERSION?.trim() || 'v20.0').replace(/^v/i, 'v');
    const { pageToken } = await getPageAccessToken({ graphVersion, userAccessToken, pageId });

    // Leadgen forms
    const formsUrl = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pageId)}/leadgen_forms`);
    formsUrl.searchParams.set('fields', 'id,name,status');
    formsUrl.searchParams.set('limit', '200');

    const r = await graphGet(formsUrl.toString(), pageToken);
    if (!r.ok) return json(r.status, { error: 'graph_error', where: 'page/leadgen_forms', raw: r.raw });

    const forms = toForms(r.raw);
    return json(200, { ok: true, pageId, forms });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { error: 'server_error', detail: msg });
  }
}
