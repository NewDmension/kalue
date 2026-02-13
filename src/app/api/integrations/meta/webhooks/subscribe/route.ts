// src/app/api/integrations/meta/webhooks/subscribe/route.ts
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

async function graphPost(url: string, accessToken: string): Promise<{ ok: boolean; status: number; raw: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
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
  return decryptToken(data.access_token_ciphertext);
}

async function getPageAccessToken(args: {
  graphVersion: string;
  userAccessToken: string;
  pageId: string;
}): Promise<{ pageToken: string; pageName?: string }> {
  const url = new URL(`https://graph.facebook.com/${args.graphVersion}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token');
  url.searchParams.set('limit', '200');

  const r = await graphGet(url.toString(), args.userAccessToken);
  if (!r.ok) throw new Error('graph_error_me_accounts');

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

function detectNeedsLeadsRetrieval(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const err = raw.error;
  if (!isRecord(err)) return false;
  const msg = err.message;
  return typeof msg === 'string' && msg.includes('leads_retrieval');
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
    const pageId = pickString(body, 'pageId');

    if (!integrationId) return json(400, { error: 'missing_integrationId' });
    if (!pageId) return json(400, { error: 'missing_pageId' });

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

    const graphVersion = (process.env.META_GRAPH_VERSION?.trim() || 'v20.0').replace(/^v/i, 'v');
    const userAccessToken = await getUserAccessToken({ admin, workspaceId, integrationId });
    const { pageToken, pageName } = await getPageAccessToken({ graphVersion, userAccessToken, pageId });

    const subUrl = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pageId)}/subscribed_apps`);
    subUrl.searchParams.set('subscribed_fields', 'leadgen');

    const r = await graphPost(subUrl.toString(), pageToken);

    if (!r.ok) {
      const needsLeadsRetrieval = detectNeedsLeadsRetrieval(r.raw);
      const lastError = needsLeadsRetrieval ? 'needs_leads_retrieval' : 'subscribe_failed';
      const mappingStatus = needsLeadsRetrieval ? 'draft' : 'error';

      // ✅ multi-tenant ON CONFLICT
      await admin
        .from('integration_meta_webhook_subscriptions')
        .upsert(
          {
            workspace_id: workspaceId,
            integration_id: integrationId,
            page_id: pageId,
            subscribed: false,
            last_error: lastError,
          },
          { onConflict: 'workspace_id,integration_id,page_id' }
        );

      // ✅ NO actualizar todo por integration_id. Solo el pageId del workspace.
      await admin
        .from('integration_meta_mappings')
        .update({
          status: mappingStatus,
          last_error: lastError,
          webhook_subscribed: false,
          subscribed_at: null,
        })
        .eq('workspace_id', workspaceId)
        .eq('integration_id', integrationId)
        .eq('page_id', pageId);

      return json(r.status, {
        error: 'graph_error',
        where: 'page/subscribed_apps',
        code: lastError,
        raw: r.raw,
      });
    }

    const nowIso = new Date().toISOString();

    await admin
      .from('integration_meta_webhook_subscriptions')
      .upsert(
        {
          workspace_id: workspaceId,
          integration_id: integrationId,
          page_id: pageId,
          subscribed: true,
          subscribed_at: nowIso,
          last_error: null,
        },
        { onConflict: 'workspace_id,integration_id,page_id' }
      );

    await admin
      .from('integration_meta_mappings')
      .update({
        page_name: pageName ?? null,
        webhook_subscribed: true,
        subscribed_at: nowIso,
        status: 'active',
        last_error: null,
      })
      .eq('workspace_id', workspaceId)
      .eq('integration_id', integrationId)
      .eq('page_id', pageId);

    return json(200, { ok: true, subscribed: true, pageId, pageName: pageName ?? null });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { error: 'server_error', detail: msg });
  }
}
