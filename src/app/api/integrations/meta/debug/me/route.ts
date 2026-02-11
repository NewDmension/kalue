import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
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

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

type TokenRow = { access_token_ciphertext: string | null };

type GraphMeResp = { id?: string; name?: string };
type AccountsResp = { data?: Array<{ id?: string; name?: string }> };

type DebugTokenResp = {
  data?: {
    is_valid?: boolean;
    scopes?: string[];
    user_id?: string;
    app_id?: string;
    expires_at?: number;
  };
};

async function graphGet<T>(path: string, accessToken: string): Promise<{ ok: boolean; status: number; json: T }> {
  const url = new URL(`https://graph.facebook.com/v19.0/${path}`);
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url.toString(), { method: 'GET' });
  const json = (await res.json()) as T;
  return { ok: res.ok, status: res.status, json };
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const appId = getEnv('META_APP_ID');
    const appSecret = getEnv('META_APP_SECRET');

    const wsId = getWorkspaceId(req);

    // ✅ Auth via cookies (no Authorization header required)
    const cookieStore = await cookies();
    const supabaseServer = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {
          // route handler GET: no-op
        },
        remove() {
          // route handler GET: no-op
        },
      },
    });

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser();
    if (userErr || !userData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = userData.user.id;

    // Admin client
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Membership check
    const { data: member } = await admin
      .from('workspace_members')
      .select('workspace_id,user_id')
      .eq('workspace_id', wsId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Integration
    const { data: integration } = await admin
      .from('integrations')
      .select('id,status')
      .eq('workspace_id', wsId)
      .eq('provider', 'meta')
      .maybeSingle();

    if (!integration) return NextResponse.json({ error: 'Meta not connected' }, { status: 400 });

    // Latest token
    const { data: trow } = await admin
      .from('integration_oauth_tokens')
      .select('access_token_ciphertext')
      .eq('workspace_id', wsId)
      .eq('integration_id', integration.id)
      .eq('provider', 'meta')
      .order('obtained_at', { ascending: false })
      .limit(1)
      .maybeSingle<TokenRow>();

    const ciphertext = trow?.access_token_ciphertext ?? null;
    if (!ciphertext) return NextResponse.json({ error: 'Missing oauth token' }, { status: 400 });

    const accessToken = decryptToken(ciphertext);
    if (!accessToken) return NextResponse.json({ error: 'Failed to decrypt token' }, { status: 400 });

    // /me
    const me = await graphGet<GraphMeResp>('me', accessToken);
    if (!me.ok) return NextResponse.json({ error: 'Failed /me', meta: me.json }, { status: 400 });

    // /debug_token
    const dbgUrl = new URL('https://graph.facebook.com/v19.0/debug_token');
    dbgUrl.searchParams.set('input_token', accessToken);
    dbgUrl.searchParams.set('access_token', `${appId}|${appSecret}`);

    const dbgRes = await fetch(dbgUrl.toString(), { method: 'GET' });
    const dbgJson = (await dbgRes.json()) as DebugTokenResp;

    // /me/accounts
    const accounts = await graphGet<AccountsResp>('me/accounts', accessToken);

    return NextResponse.json({
      me: { id: pickString(me.json.id), name: pickString(me.json.name) },
      token: {
        is_valid: dbgJson.data?.is_valid ?? null,
        user_id: dbgJson.data?.user_id ?? null,
        app_id: dbgJson.data?.app_id ?? null,
        expires_at: dbgJson.data?.expires_at ?? null,
        scopes: Array.isArray(dbgJson.data?.scopes) ? dbgJson.data!.scopes : [],
      },
      accountsCount: Array.isArray(accounts.json.data) ? accounts.json.data.length : 0,
      accountsPreview: Array.isArray(accounts.json.data)
        ? accounts.json.data
            .map((p) => {
              const id = pickString(p.id);
              const name = pickString(p.name);
              return id && name ? { id, name } : null;
            })
            .filter((v): v is { id: string; name: string } => v !== null)
            .slice(0, 5)
        : [],
      accountsError: accounts.ok ? null : accounts.json,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
