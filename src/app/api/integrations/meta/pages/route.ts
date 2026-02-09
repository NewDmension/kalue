import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

type GraphAccountsResp = {
  data?: Array<{ id?: string; name?: string; access_token?: string }>;
};

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearerToken(req);
    const workspaceId = getWorkspaceId(req);

    // user
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = userData.user.id;

    // verify membership
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: member } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id,user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // load integration meta for this workspace
    const { data: integration } = await supabaseAdmin
      .from('integrations')
      .select('id, secrets')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'meta')
      .maybeSingle();

    if (!integration) return NextResponse.json({ error: 'Meta not connected' }, { status: 400 });

    const secrets = (typeof integration.secrets === 'object' && integration.secrets !== null) ? (integration.secrets as Record<string, unknown>) : {};
    const userAccessToken = typeof secrets['access_token'] === 'string' ? secrets['access_token'] : null;
    if (!userAccessToken) return NextResponse.json({ error: 'Missing access token' }, { status: 400 });

    // /me/accounts => pages + page access_token
    const url = new URL('https://graph.facebook.com/v19.0/me/accounts');
    url.searchParams.set('access_token', userAccessToken);

    const res = await fetch(url.toString(), { method: 'GET' });
    const json = (await res.json()) as GraphAccountsResp;
    if (!res.ok) return NextResponse.json({ error: 'Failed to list pages', meta: json }, { status: 400 });

    const pages: MetaPage[] = (json.data ?? [])
      .map((p) => (typeof p.id === 'string' && typeof p.name === 'string' ? { id: p.id, name: p.name } : null))
      .filter((v): v is MetaPage => v !== null);

    return NextResponse.json({ pages });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
