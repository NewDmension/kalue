import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Json = Record<string, unknown>;

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

type Body = { page_id: string; page_name: string };

type GraphAccountsResp = {
  data?: Array<{ id?: string; name?: string; access_token?: string }>;
};

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearerToken(req);
    const workspaceId = getWorkspaceId(req);

    const bodyUnknown: unknown = await req.json();
    if (!isRecord(bodyUnknown)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

    const pageId = typeof bodyUnknown.page_id === 'string' ? bodyUnknown.page_id : null;
    const pageName = typeof bodyUnknown.page_name === 'string' ? bodyUnknown.page_name : null;
    if (!pageId || !pageName) return NextResponse.json({ error: 'Missing page_id/page_name' }, { status: 400 });

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

    // load integration
    const { data: integration } = await supabaseAdmin
      .from('integrations')
      .select('id, secrets, config')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'meta')
      .maybeSingle();

    if (!integration) return NextResponse.json({ error: 'Meta not connected' }, { status: 400 });

    const secrets = isRecord(integration.secrets) ? integration.secrets : {};
    const userAccessToken = typeof secrets['access_token'] === 'string' ? secrets['access_token'] : null;
    if (!userAccessToken) return NextResponse.json({ error: 'Missing user access token' }, { status: 400 });

    // find page access token via /me/accounts
    const accountsUrl = new URL('https://graph.facebook.com/v19.0/me/accounts');
    accountsUrl.searchParams.set('access_token', userAccessToken);

    const accountsRes = await fetch(accountsUrl.toString(), { method: 'GET' });
    const accountsJson = (await accountsRes.json()) as GraphAccountsResp;
    if (!accountsRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch accounts', meta: accountsJson }, { status: 400 });
    }

    const match = (accountsJson.data ?? []).find((p) => p.id === pageId);
    const pageAccessToken = typeof match?.access_token === 'string' ? match.access_token : null;
    if (!pageAccessToken) return NextResponse.json({ error: 'No page access token found for this page' }, { status: 400 });

    // subscribe app to page leadgen
    const subUrl = new URL(`https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/subscribed_apps`);
    subUrl.searchParams.set('access_token', pageAccessToken);

    const subRes = await fetch(subUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ subscribed_fields: 'leadgen' }).toString(),
    });

    const subJson: unknown = await subRes.json();
    if (!subRes.ok) {
      await supabaseAdmin.from('integration_events').insert({
        workspace_id: workspaceId,
        integration_id: integration.id,
        provider: 'meta',
        type: 'error',
        payload: { reason: 'subscribe_failed', page_id: pageId, meta: subJson } as Json,
      });
      return NextResponse.json({ error: 'Failed to subscribe app to page', meta: subJson }, { status: 400 });
    }

    // save config + secrets
    const newConfig: Json = {
      ...(isRecord(integration.config) ? integration.config : {}),
      step: 'connected',
      page_id: pageId,
      page_name: pageName,
    };

    const newSecrets: Json = {
      ...(isRecord(integration.secrets) ? integration.secrets : {}),
      page_access_token: pageAccessToken,
    };

    await supabaseAdmin
      .from('integrations')
      .update({
        status: 'connected',
        config: newConfig,
        secrets: newSecrets,
        connected_at: new Date().toISOString(),
      })
      .eq('id', integration.id);

    await supabaseAdmin.from('integration_events').insert({
      workspace_id: workspaceId,
      integration_id: integration.id,
      provider: 'meta',
      type: 'connected',
      payload: { page_id: pageId } as Json,
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
