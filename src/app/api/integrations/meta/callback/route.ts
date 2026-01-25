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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getString(obj: unknown, key: string): string | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

async function exchangeCodeForToken(args: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{ access_token: string; token_type?: string; expires_in?: number }> {
  const params = new URLSearchParams({
    client_id: args.appId,
    redirect_uri: args.redirectUri,
    client_secret: args.appSecret,
    code: args.code,
  });

  const res = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?${params.toString()}`, {
    method: 'GET',
  });

  const json: unknown = await res.json();
  if (!res.ok) {
    const errMsg = isRecord(json) ? JSON.stringify(json) : 'token_exchange_failed';
    throw new Error(errMsg);
  }

  const accessToken = getString(json, 'access_token');
  if (!accessToken) throw new Error('Missing access_token from Meta');

  const tokenType = getString(json, 'token_type') ?? undefined;
  const expiresInRaw = isRecord(json) ? json['expires_in'] : undefined;
  const expiresIn = typeof expiresInRaw === 'number' ? expiresInRaw : undefined;

  return { access_token: accessToken, token_type: tokenType, expires_in: expiresIn };
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const metaAppId = getEnv('META_APP_ID');
    const metaAppSecret = getEnv('META_APP_SECRET');
    const redirectUri = getEnv('META_REDIRECT_URI');

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || !state) {
      return NextResponse.json({ error: 'Missing code/state' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // 1) Encontrar la integración "meta" cuyo oauth_state coincide (server-side)
    const { data: integration, error: intErr } = await supabaseAdmin
      .from('integrations')
      .select('id, workspace_id, secrets, config')
      .eq('provider', 'meta')
      .contains('secrets', { oauth_state: state } as Json)
      .maybeSingle();

    if (intErr || !integration) {
      return NextResponse.json({ error: 'Invalid state' }, { status: 400 });
    }

    // 2) Intercambiar code por token
    const token = await exchangeCodeForToken({
      appId: metaAppId,
      appSecret: metaAppSecret,
      redirectUri,
      code,
    });

    const now = new Date();
    const expiresAt =
      typeof token.expires_in === 'number'
        ? new Date(now.getTime() + token.expires_in * 1000).toISOString()
        : null;

    // 3) Guardar token y pasar a "pending" (siguiente step: elegir Page)
    const newSecrets: Json = {
      ...(isRecord(integration.secrets) ? integration.secrets : {}),
      oauth_state: null, // lo limpiamos
      access_token: token.access_token,
      token_type: token.token_type ?? 'bearer',
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    };

    const newConfig: Json = {
      ...(isRecord(integration.config) ? integration.config : {}),
      step: 'page_select',
    };

    const { error: upErr } = await supabaseAdmin
      .from('integrations')
      .update({
        status: 'pending',
        config: newConfig,
        secrets: newSecrets,
      })
      .eq('id', integration.id);

    if (upErr) {
      return NextResponse.json({ error: 'Failed to save token' }, { status: 500 });
    }

    // 4) Log
    await supabaseAdmin.from('integration_events').insert({
      workspace_id: integration.workspace_id,
      integration_id: integration.id,
      provider: 'meta',
      type: 'oauth_completed',
      payload: { has_expires_at: Boolean(expiresAt) } as Json,
    });

    // 5) Redirect a tu UI de integraciones para step 2 (selección de Page)
    // Ajusta la ruta según tu app (ej: /integrations?provider=meta)
    return NextResponse.redirect(new URL('/integrations?provider=meta&step=page', req.url));
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
