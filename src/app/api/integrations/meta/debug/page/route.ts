import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { decryptToken } from '@/server/crypto/tokenCrypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

function getQuery(req: Request, key: string): string {
  const url = new URL(req.url);
  const v = url.searchParams.get(key);
  const s = v?.trim() ?? '';
  if (!s) throw new Error(`Missing ${key} query param`);
  return s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

type GraphError = {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  error_subcode?: unknown;
  fbtrace_id?: unknown;
};

type GraphAnyResp = {
  id?: unknown;
  name?: unknown;
  access_token?: unknown;
  tasks?: unknown;
  error?: GraphError;
};

async function fetchGraphJson(url: string, token?: string): Promise<{ ok: boolean; status: number; raw: unknown }> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
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

function pickGraphError(raw: unknown): { message: string; type?: string; code?: number; subcode?: number } {
  if (!isRecord(raw)) return { message: 'Unknown graph error' };
  const err = raw.error;
  if (!isRecord(err)) return { message: 'Unknown graph error' };

  const message = typeof err.message === 'string' ? err.message : JSON.stringify(err);
  const type = typeof err.type === 'string' ? err.type : undefined;
  const code = typeof err.code === 'number' ? err.code : undefined;
  const subcode = typeof err.error_subcode === 'number' ? err.error_subcode : undefined;

  return { message, type, code, subcode };
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const workspaceId = getWorkspaceId(req);
    const integrationId = getQuery(req, 'integrationId');
    const pageId = getQuery(req, 'pageId');

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
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // 3) verify membership
    const { data: member, error: memberErr } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id,user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (memberErr) {
      return NextResponse.json({ error: 'db_error', detail: memberErr.message }, { status: 500 });
    }
    if (!member) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4) load token
    const { data: tok, error: tokErr } = await supabaseAdmin
      .from('integration_oauth_tokens')
      .select('access_token_ciphertext')
      .eq('workspace_id', workspaceId)
      .eq('integration_id', integrationId)
      .eq('provider', 'meta')
      .maybeSingle();

    if (tokErr) {
      return NextResponse.json({ error: 'db_error', detail: tokErr.message }, { status: 500 });
    }
    if (!tok?.access_token_ciphertext) {
      return NextResponse.json({ error: 'token_not_found' }, { status: 404 });
    }

    let userAccessToken = '';
    try {
      userAccessToken = decryptToken(tok.access_token_ciphertext);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'decrypt_failed';
      return NextResponse.json({ error: 'decrypt_failed', detail: msg }, { status: 500 });
    }

    // 5) Dos pruebas:
    // A) "public check" sin token (solo id,name)
    // B) "token check" con token (id,name,access_token,tasks)
    const publicUrl = new URL(`https://graph.facebook.com/v20.0/${encodeURIComponent(pageId)}`);
    publicUrl.searchParams.set('fields', 'id,name');

    const tokenUrl = new URL(`https://graph.facebook.com/v20.0/${encodeURIComponent(pageId)}`);
    tokenUrl.searchParams.set('fields', 'id,name,access_token,tasks');
    tokenUrl.searchParams.set('access_token', userAccessToken);

    const pub = await fetchGraphJson(publicUrl.toString());
    const tokRes = await fetchGraphJson(tokenUrl.toString(), userAccessToken);

    // Parse “bonito” del token response si va bien
    let page: { id: string; name: string; has_page_access_token: boolean } | null = null;
    if (tokRes.ok && isRecord(tokRes.raw)) {
      const r = tokRes.raw as GraphAnyResp;
      const id = typeof r.id === 'string' ? r.id : '';
      const name = typeof r.name === 'string' ? r.name : '';
      const pageAccessToken = typeof r.access_token === 'string' ? r.access_token : '';
      if (id && name) {
        page = { id, name, has_page_access_token: Boolean(pageAccessToken) };
      }
    }

    // Si el token check falla, devolvemos SIEMPRE el mensaje de error
    if (!tokRes.ok) {
      const err = pickGraphError(tokRes.raw);
      return NextResponse.json(
        {
          error: 'graph_error',
          status: tokRes.status,
          graph: err,
          // clave: ver si el ID existe “público”
          publicCheck: { ok: pub.ok, status: pub.status, raw: pub.raw },
          raw: tokRes.raw,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      page,
      publicCheck: { ok: pub.ok, status: pub.status, raw: pub.raw },
      raw: tokRes.raw,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
