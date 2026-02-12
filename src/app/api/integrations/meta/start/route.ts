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

function getEnvOptional(name: string): string | null {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : null;
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

function splitScopes(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Lista blanca de permisos seguros para desbloquear el login (fase 1: conectar bien).
 * Luego ya añadiremos los de lead ads / webhooks cuando toque.
 */
const LOGIN_SCOPE_ALLOWLIST = new Set<string>([
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
]);

function normalizeLoginScopes(scopes: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const s of scopes) {
    const key = s.trim();
    if (!key) continue;
    if (!LOGIN_SCOPE_ALLOWLIST.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  // Meta suele tolerar scope vacío, pero mejor asegurar mínimos si el env estuviera mal
  if (out.length === 0) {
    out.push('public_profile', 'pages_show_list');
  }

  return out;
}

function buildMetaOAuthUrl(args: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  // 1) Scopes desde env
  const rawFromEnv = getEnvOptional('META_OAUTH_SCOPES') ?? 'public_profile,pages_show_list,pages_read_engagement';
  const scopesFromEnv = splitScopes(rawFromEnv);

  // 2) Filtramos a lista blanca (evita "Invalid Scopes" como leads_retrieval)
  const finalScopes = normalizeLoginScopes(scopesFromEnv);
  const scope = finalScopes.join(',');

  // 3) Graph version
  const graphVersion = getEnvOptional('META_GRAPH_VERSION') ?? 'v20.0';

  const params = new URLSearchParams({
    client_id: args.appId,
    redirect_uri: args.redirectUri,
    state: args.state,
    response_type: 'code',
    scope,
  });

  return `https://www.facebook.com/${graphVersion}/dialog/oauth?${params.toString()}`;
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

    // 5) Redirect a Meta OAuth (devolvemos url al frontend)
    const url = buildMetaOAuthUrl({ appId: metaAppId, redirectUri, state });
    return NextResponse.json({ url });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
