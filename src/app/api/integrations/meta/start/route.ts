import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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

function randomState(): string {
  return crypto.randomBytes(24).toString('hex');
}

function buildMetaOAuthUrl(args: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const scope = [
    // mínimos típicos para lead ads (puede ajustarse luego)
    'pages_show_list',
    'pages_read_engagement',
    'leads_retrieval',
  ].join(',');

  const params = new URLSearchParams({
    client_id: args.appId,
    redirect_uri: args.redirectUri,
    state: args.state,
    response_type: 'code',
    scope,
  });

  return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseAnonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const metaAppId = getEnv('META_APP_ID');
    const redirectUri = getEnv('META_REDIRECT_URI');

    const token = getBearerToken(req);
    const workspaceId = getWorkspaceId(req);

    // 1) Validar usuario via JWT
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = userData.user.id;

    // 2) Validar membresía de workspace
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: member, error: memErr } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id,user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (memErr || !member) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3) Upsert integración "meta" en pending + guardar state server-side
    const state = randomState();
    const nowIso = new Date().toISOString();

    const { data: integrationUpsert, error: upErr } = await supabaseAdmin
      .from('integrations')
      .upsert(
        {
          workspace_id: workspaceId,
          provider: 'meta',
          status: 'pending',
          config: { step: 'oauth_started' } as Json,
          secrets: { oauth_state: state, oauth_started_at: nowIso } as Json,
        },
        { onConflict: 'workspace_id,provider' }
      )
      .select('id')
      .single();

    if (upErr || !integrationUpsert) {
      return NextResponse.json({ error: 'Failed to create integration' }, { status: 500 });
    }

    // 4) Log event
    await supabaseAdmin.from('integration_events').insert({
      workspace_id: workspaceId,
      integration_id: integrationUpsert.id,
      provider: 'meta',
      type: 'oauth_started',
      payload: { at: nowIso } as Json,
    });

    // 5) Redirect a Meta OAuth
    const url = buildMetaOAuthUrl({ appId: metaAppId, redirectUri, state });
    return NextResponse.redirect(url);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
