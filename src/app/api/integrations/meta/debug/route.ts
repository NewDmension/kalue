import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { decryptToken } from '@/server/crypto/tokenCrypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LeadForm = {
  id: string;
  name: string;
  status: string | null;
  created_time: string | null;
};

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

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _nonJson: true, text };
  }
}

type GraphResp = {
  data?: Array<{ id?: unknown; name?: unknown; status?: unknown; created_time?: unknown }>;
  error?: { message?: unknown; type?: unknown; code?: unknown; error_subcode?: unknown; fbtrace_id?: unknown };
};

function pickGraphError(raw: unknown): string {
  if (!isRecord(raw)) return 'Unknown graph error';
  const err = raw.error;
  if (!isRecord(err)) return 'Unknown graph error';
  if (typeof err.message === 'string') return err.message;
  return JSON.stringify(err);
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

    // 4) load oauth token ciphertext
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

    // 5) Graph: /{pageId}/leadgen_forms
    const graph = new URL(`https://graph.facebook.com/v20.0/${encodeURIComponent(pageId)}/leadgen_forms`);
    graph.searchParams.set('access_token', userAccessToken);
    graph.searchParams.set('fields', 'id,name,status,created_time');
    graph.searchParams.set('limit', '200');

    const res = await fetch(graph.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${userAccessToken}`,
      },
      cache: 'no-store',
    });

    const raw = await safeJson(res);
    const parsed: GraphResp = isRecord(raw) ? (raw as GraphResp) : {};

    if (!res.ok) {
      return NextResponse.json(
        {
          error: 'graph_error',
          status: res.status,
          message: pickGraphError(raw),
          raw,
        },
        { status: 400 },
      );
    }

    const forms: LeadForm[] = (parsed.data ?? [])
      .map((f) => {
        const id = pickString(f.id);
        const name = pickString(f.name);
        if (!id || !name) return null;
        return {
          id,
          name,
          status: pickString(f.status),
          created_time: pickString(f.created_time),
        };
      })
      .filter((v): v is LeadForm => v !== null);

    return NextResponse.json({
      ok: true,
      count: forms.length,
      forms,
      raw,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
