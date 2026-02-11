import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

import { decryptToken } from '@/server/crypto/tokenCrypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MetaPage = { id: string; name: string };

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

type GraphAccountsResp = {
  data?: Array<{ id?: unknown; name?: unknown }>;
  paging?: unknown;
  error?: { message?: string; type?: string; code?: number; fbtrace_id?: string };
};

function parseJsonText(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _nonJson: true, text };
  }
}

function pickPages(raw: unknown): MetaPage[] {
  if (!isRecord(raw)) return [];
  const data = raw.data;
  if (!Array.isArray(data)) return [];

  const out: MetaPage[] = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id : '';
    const name = typeof item.name === 'string' ? item.name : '';
    if (!id || !name) continue;
    out.push({ id, name });
  }
  return out;
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

    // 2) admin client (service role)
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

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

    // 5) Graph: /me/accounts (pedimos MINIMO: id,name)
    const graph = new URL('https://graph.facebook.com/v20.0/me/accounts');
    graph.searchParams.set('access_token', userAccessToken);
    graph.searchParams.set('fields', 'id,name');
    graph.searchParams.set('limit', '200');

    const res = await fetch(graph.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${userAccessToken}`,
      },
      cache: 'no-store',
    });

    const text = await res.text();
    const raw = parseJsonText(text);
    const parsed: GraphAccountsResp = isRecord(raw) ? (raw as GraphAccountsResp) : {};

    if (!res.ok) {
      return NextResponse.json(
        {
          error: 'graph_error',
          status: res.status,
          meta: parsed.error ?? parsed,
          raw,
        },
        { status: res.status },
      );
    }

    const pages = pickPages(raw);
    return NextResponse.json({
      rawCount: pages.length,
      pages,
      raw, // útil para ver paging / warnings
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
