import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { decryptToken } from '@/server/crypto/tokenCrypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MetaPage = { id: string; name: string; perms: string[] };

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getWorkspaceId(req: Request): string {
  const v = req.headers.get('x-workspace-id');
  if (!v) throw new Error('Missing x-workspace-id header');
  return v;
}

function getIntegrationId(req: Request): string {
  const url = new URL(req.url);
  const v = url.searchParams.get('integrationId');
  const s = v?.trim();
  if (!s) throw new Error('Missing integrationId query param');
  return s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function pickString(v: unknown, key: string): string {
  if (!isRecord(v)) return '';
  const x = v[key];
  return typeof x === 'string' ? x : '';
}

// ✅ acepta token en claro o JSON envelope
function extractAccessTokenFromString(raw: string): string {
  const s = raw.trim();
  if (!s) return '';

  // Caso normal: token en claro
  if (!s.startsWith('{')) return s;

  // Caso: JSON
  try {
    const obj: unknown = JSON.parse(s);
    const t1 = pickString(obj, 'access_token');
    if (t1) return t1;

    const t2 = pickString(obj, 'token');
    if (t2) return t2;

    // Si no encontramos claves típicas, no es útil
    return '';
  } catch {
    // No es JSON válido → probablemente era token en claro con caracteres raros / o basura
    return '';
  }
}

function resolveUserAccessToken(ciphertext: string): { ok: true; token: string } | { ok: false; error: string; detail?: string } {
  const input = ciphertext.trim();
  if (!input) return { ok: false, error: 'token_missing' };

  // 1) Intento normal: descifrar
  try {
    const decrypted = decryptToken(input);
    const token = extractAccessTokenFromString(decrypted);
    if (token) return { ok: true, token };

    return { ok: false, error: 'decrypt_ok_but_token_invalid', detail: 'Decrypted value did not contain a usable access token.' };
  } catch (e: unknown) {
    // 2) Fallback: puede que NO esté cifrado aún (tu caso)
    const fallback = extractAccessTokenFromString(input);
    if (fallback) return { ok: true, token: fallback };

    const msg = e instanceof Error ? e.message : 'decrypt_failed';
    return { ok: false, error: 'decrypt_failed', detail: msg };
  }
}

type GraphError = { message?: string; type?: string; code?: number; fbtrace_id?: string };

type GraphPaging = {
  next?: unknown;
};

type GraphAccountsItem = {
  id?: unknown;
  name?: unknown;
  access_token?: unknown;
  perms?: unknown;
};

type GraphAccountsResp = {
  data?: GraphAccountsItem[];
  paging?: GraphPaging;
  error?: GraphError;
};

type GraphBusinessItem = { id?: unknown; name?: unknown };
type GraphBusinessesResp = { data?: GraphBusinessItem[]; paging?: GraphPaging; error?: GraphError };

type GraphOwnedPagesItem = { id?: unknown; name?: unknown; perms?: unknown };
type GraphOwnedPagesResp = { data?: GraphOwnedPagesItem[]; paging?: GraphPaging; error?: GraphError };

async function safeGraphJson<T extends Record<string, unknown>>(res: Response): Promise<{ raw: unknown; parsed: T }> {
  const text = await res.text();
  let raw: unknown = null;
  try {
    raw = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    raw = { _nonJson: true, text };
  }
  const parsed = (isRecord(raw) ? (raw as T) : ({} as T));
  return { raw, parsed };
}

function toMetaPagesFromAccounts(parsed: GraphAccountsResp): MetaPage[] {
  return (parsed.data ?? [])
    .map((p) => {
      const id = typeof p.id === 'string' ? p.id : null;
      const name = typeof p.name === 'string' ? p.name : null;
      if (!id || !name) return null;
      const perms = pickStringArray(p.perms);
      return { id, name, perms };
    })
    .filter((v): v is MetaPage => v !== null);
}

function toMetaPagesFromOwnedPages(parsed: GraphOwnedPagesResp): MetaPage[] {
  return (parsed.data ?? [])
    .map((p) => {
      const id = typeof p.id === 'string' ? p.id : null;
      const name = typeof p.name === 'string' ? p.name : null;
      if (!id || !name) return null;
      const perms = pickStringArray(p.perms);
      return { id, name, perms };
    })
    .filter((v): v is MetaPage => v !== null);
}

async function graphGet<T extends Record<string, unknown>>(
  url: string,
  userAccessToken: string
): Promise<{ raw: unknown; parsed: T; res: Response }> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${userAccessToken}`,
    },
    cache: 'no-store',
  });

  const { raw, parsed } = await safeGraphJson<T>(res);
  return { raw, parsed, res };
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

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const workspaceId = getWorkspaceId(req);
    const integrationId = getIntegrationId(req);

    // 1) auth user desde cookies
    const cookieStore = await cookies();
    const supabaseServer = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    });

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser();
    if (userErr || !userData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = userData.user.id;

    // 2) admin client
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // 3) verify membership
    const ok = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // 4) load oauth token ciphertext
    const { data: tok, error: tokErr } = await admin
      .from('integration_oauth_tokens')
      .select('access_token_ciphertext')
      .eq('workspace_id', workspaceId)
      .eq('integration_id', integrationId)
      .eq('provider', 'meta')
      .maybeSingle();

    if (tokErr) return NextResponse.json({ error: 'db_error', detail: tokErr.message }, { status: 500 });
    if (!tok?.access_token_ciphertext) return NextResponse.json({ error: 'token_not_found' }, { status: 404 });

    const resolved = resolveUserAccessToken(tok.access_token_ciphertext);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error, detail: resolved.detail ?? '' }, { status: 500 });
    }
    const userAccessToken = resolved.token;

    const graphVersion = process.env.META_GRAPH_VERSION?.trim() || 'v20.0';

    // A) intento clásico: /me/accounts
    const accountsUrl = new URL(`https://graph.facebook.com/${graphVersion}/me/accounts`);
    accountsUrl.searchParams.set('fields', 'id,name,perms');
    accountsUrl.searchParams.set('limit', '200');
    accountsUrl.searchParams.set('access_token', userAccessToken);

    const accounts = await graphGet<GraphAccountsResp>(accountsUrl.toString(), userAccessToken);

    if (!accounts.res.ok) {
  const msg =
    typeof accounts.parsed?.error?.message === 'string'
      ? accounts.parsed.error.message
      : 'Meta Graph error';

  const code =
    typeof accounts.parsed?.error?.code === 'number'
      ? accounts.parsed.error.code
      : undefined;

  const fbtrace =
    typeof accounts.parsed?.error?.fbtrace_id === 'string'
      ? accounts.parsed.error.fbtrace_id
      : undefined;

  return NextResponse.json(
    {
      error: 'graph_error',
      where: 'me/accounts',
      status: accounts.res.status,
      detail: msg,
      code,
      fbtrace_id: fbtrace,
      raw: accounts.raw,
    },
    { status: accounts.res.status }
  );
}


    const pagesFromAccounts = toMetaPagesFromAccounts(accounts.parsed);

    // ✅ Si ya hay Pages, devolvemos
    if (pagesFromAccounts.length > 0) {
      return NextResponse.json({
        source: 'me/accounts',
        rawCount: Array.isArray(accounts.parsed.data) ? accounts.parsed.data.length : 0,
        pages: pagesFromAccounts,
      });
    }

    // B) fallback: Business Manager
    // Requiere scope business_management
    const businessesUrl = new URL(`https://graph.facebook.com/${graphVersion}/me/businesses`);
    businessesUrl.searchParams.set('fields', 'id,name');
    businessesUrl.searchParams.set('limit', '200');
    businessesUrl.searchParams.set('access_token', userAccessToken);

    const businesses = await graphGet<GraphBusinessesResp>(businessesUrl.toString(), userAccessToken);

    if (!businesses.res.ok) {
      return NextResponse.json(
        {
          error: 'graph_error',
          where: 'me/businesses',
          status: businesses.res.status,
          meta: businesses.parsed.error ?? businesses.parsed,
          raw: businesses.raw,
          hint: 'Si esto falla, revisa que el OAuth tenga scope business_management y re-conecta.',
        },
        { status: businesses.res.status }
      );
    }

    const bizIds = (businesses.parsed.data ?? [])
      .map((b) => (typeof b.id === 'string' ? b.id : null))
      .filter((x): x is string => x !== null);

    const allPages: MetaPage[] = [];

    for (const bizId of bizIds) {
      const ownedPagesUrl = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(bizId)}/owned_pages`);
      ownedPagesUrl.searchParams.set('fields', 'id,name,perms');
      ownedPagesUrl.searchParams.set('limit', '200');
      ownedPagesUrl.searchParams.set('access_token', userAccessToken);

      const owned = await graphGet<GraphOwnedPagesResp>(ownedPagesUrl.toString(), userAccessToken);

      if (!owned.res.ok) {
        // no abortamos todo; seguimos con otras businesses
        continue;
      }

      const pages = toMetaPagesFromOwnedPages(owned.parsed);
      allPages.push(...pages);
    }

    // dedupe por id
    const uniq = new Map<string, MetaPage>();
    for (const p of allPages) {
      if (!uniq.has(p.id)) uniq.set(p.id, p);
    }

    return NextResponse.json({
      source: 'business_manager_fallback',
      pages: Array.from(uniq.values()),
      note: 'Si pages sigue vacío, entonces no estás asignado a Pages en ese Business o el Business no tiene owned_pages.',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
