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
  return v.trim();
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

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _nonJson: true, text };
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const workspaceId = getWorkspaceId(req);
    const integrationId = getIntegrationId(req);

    // auth user desde cookies
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
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const userId = userData.user.id;

    // admin client
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // membership
    const { data: member, error: memErr } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (memErr) return NextResponse.json({ error: 'db_error', detail: memErr.message }, { status: 500 });
    if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    // token
    const { data: tok, error: tokErr } = await admin
      .from('integration_oauth_tokens')
      .select('access_token_ciphertext')
      .eq('workspace_id', workspaceId)
      .eq('integration_id', integrationId)
      .eq('provider', 'meta')
      .maybeSingle();

    if (tokErr) return NextResponse.json({ error: 'db_error', detail: tokErr.message }, { status: 500 });
    if (!tok?.access_token_ciphertext) return NextResponse.json({ error: 'token_not_found' }, { status: 404 });

    // ✅ compat decrypt (igual que /pages)
    let userAccessToken = '';
    try {
      userAccessToken = decryptToken(tok.access_token_ciphertext);
    } catch {
      userAccessToken = tok.access_token_ciphertext;
    }

    if (!userAccessToken) return NextResponse.json({ error: 'invalid_token' }, { status: 500 });

    // Graph /me
    const meUrl = new URL('https://graph.facebook.com/v20.0/me');
    meUrl.searchParams.set('fields', 'id,name');
    meUrl.searchParams.set('access_token', userAccessToken);

    const res = await fetch(meUrl.toString(), { method: 'GET', cache: 'no-store' });
    const raw = await safeJson(res);

    if (!res.ok) {
      return NextResponse.json(
        { error: 'graph_error', status: res.status, raw },
        { status: res.status }
      );
    }

    // devolvemos /me + userId supabase (útil para confirmar identidad)
    const me = isRecord(raw) ? raw : { raw };
    return NextResponse.json({ ok: true, supabaseUserId: userId, me });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: 'bad_request', detail: msg }, { status: 400 });
  }
}
