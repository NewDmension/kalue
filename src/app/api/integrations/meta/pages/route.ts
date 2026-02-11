import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// AJUSTA este import a tu ruta real
import { decryptToken } from '@/server/crypto/tokenCrypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MetaPage = { id: string; name: string };

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getBearerToken(req: Request): string {
  const h = req.headers.get('authorization');
  if (!h) throw new Error('Missing Authorization header');
  const [kind, token] = h.split(' ');
  if (kind !== 'Bearer' || !token) throw new Error('Invalid Authorization header');
  return token;
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

type GraphAccountsResp = {
  data?: Array<{ id?: string; name?: string; access_token?: string }>;
  error?: { message?: string; type?: string; code?: number; fbtrace_id?: string };
};

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearerToken(req);
    const workspaceId = getWorkspaceId(req);
    const integrationId = getIntegrationId(req);

    // 1) auth user
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = userData.user.id;

    // 2) verify membership
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

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

    // 3) load oauth token ciphertext from integration_oauth_tokens
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

    const userAccessToken = decryptToken(tok.access_token_ciphertext);

    // 4) Graph: /me/accounts => pages
    const url = new URL('https://graph.facebook.com/v20.0/me/accounts');
    url.searchParams.set('fields', 'id,name');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${userAccessToken}`,
      },
      cache: 'no-store',
    });

    const body = (await res.json()) as unknown;

    const parsed: GraphAccountsResp =
      typeof body === 'object' && body !== null ? (body as GraphAccountsResp) : {};

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Failed to list pages', meta: parsed.error ?? parsed },
        { status: res.status },
      );
    }

    const pages: MetaPage[] = (parsed.data ?? [])
      .map((p) => (typeof p.id === 'string' && typeof p.name === 'string' ? { id: p.id, name: p.name } : null))
      .filter((v): v is MetaPage => v !== null);

    return NextResponse.json({ pages });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
