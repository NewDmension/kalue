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

    const workspaceId = getWorkspaceId(req);
    const integrationId = getIntegrationId(req);

    const cookieStore = await cookies();
    const supabaseServer = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    });

    const { data: userData } = await supabaseServer.auth.getUser();
    if (!userData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = userData.user.id;

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: member } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id,user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: tok } = await supabaseAdmin
      .from('integration_oauth_tokens')
      .select('access_token_ciphertext')
      .eq('workspace_id', workspaceId)
      .eq('integration_id', integrationId)
      .eq('provider', 'meta')
      .maybeSingle();

    if (!tok?.access_token_ciphertext) {
      return NextResponse.json({ error: 'token_not_found' }, { status: 404 });
    }

    const userAccessToken = decryptToken(tok.access_token_ciphertext);

    const url = new URL('https://graph.facebook.com/v20.0/me/accounts');
    url.searchParams.set('fields', 'id,name,access_token');

    const res = await fetch(url.toString(), {
      headers: { accept: 'application/json', authorization: `Bearer ${userAccessToken}` },
      cache: 'no-store',
    });

    const body = (await res.json()) as unknown;
    const parsed: GraphAccountsResp = typeof body === 'object' && body !== null ? (body as GraphAccountsResp) : {};

    if (!res.ok) {
      return NextResponse.json({ error: 'meta_error', status: res.status, meta: parsed.error ?? parsed }, { status: res.status });
    }

    const items = Array.isArray(parsed.data) ? parsed.data : [];
    const sanitized = items.map((p) => ({
      id: typeof p.id === 'string' ? p.id : null,
      name: typeof p.name === 'string' ? p.name : null,
      has_access_token: typeof p.access_token === 'string' && p.access_token.length > 0,
    }));

    return NextResponse.json({ rawCount: items.length, pages: sanitized });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 400 });
  }
}
