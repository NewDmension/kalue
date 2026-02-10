import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { encryptToken } from '@/server/crypto/tokenCrypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function base64urlToString(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64').toString('utf8');
}

function hmacSha256Base64url(secret: string, payload: string): string {
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64');
  return sig.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function safeRedirect(to: string): NextResponse {
  return NextResponse.redirect(to);
}

function getBaseUrl(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (!host) throw new Error('Missing host header');
  return `${proto}://${host}`;
}

type MetaTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickString(v: unknown, key: string): string {
  if (!isRecord(v)) return '';
  const x = v[key];
  return typeof x === 'string' ? x : '';
}

function pickNumber(v: unknown, key: string): number | null {
  if (!isRecord(v)) return null;
  const x = v[key];
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  let raw: unknown = null;

  try {
    raw = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    raw = { _nonJson: true, text };
  }

  if (!res.ok) {
    const detail =
      isRecord(raw) && typeof raw.error === 'object' && raw.error
        ? JSON.stringify(raw.error)
        : typeof text === 'string'
          ? text
          : '';
    throw new Error(`Meta token error (${res.status}) ${detail}`.trim());
  }

  return raw;
}

export async function GET(req: Request) {
  const baseUrl = (() => {
    try {
      return getBaseUrl(req);
    } catch {
      return '';
    }
  })();

  const url = new URL(req.url);

  // ✅ si el usuario cancela, Meta suele devolver esto
  const metaErr = (url.searchParams.get('error') ?? '').trim();
  const metaErrReason = (url.searchParams.get('error_reason') ?? '').trim();
  const metaErrDesc = (url.searchParams.get('error_description') ?? '').trim();

  // Para volver a una pantalla “segura” si aún no tenemos integrationId
  const genericErrorRedirect = baseUrl ? `${baseUrl}/integrations?oauth=error` : '/integrations?oauth=error';

  try {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

    const metaAppId = requireEnv('META_APP_ID');
    const metaAppSecret = requireEnv('META_APP_SECRET');
    const stateSecret = requireEnv('META_OAUTH_STATE_SECRET');

    const graphVersion = getEnv('META_GRAPH_VERSION', 'v20.0');
    const exchangeLongLived = getEnv('META_EXCHANGE_LONG_LIVED', 'true').toLowerCase() !== 'false';

    const code = (url.searchParams.get('code') ?? '').trim();
    const state = (url.searchParams.get('state') ?? '').trim();

    if (!state) {
      // Si cancelas, a veces viene error sin state (depende flujo)
      const reason = metaErr ? `meta_${metaErr}` : 'missing_state';
      return safeRedirect(`${genericErrorRedirect}&reason=${encodeURIComponent(reason)}`);
    }

    const parts = state.split('.');
    if (parts.length !== 2) return safeRedirect(`${genericErrorRedirect}&reason=bad_state_format`);

    const encodedPayload = parts[0] ?? '';
    const sig = parts[1] ?? '';

    const expectedSig = hmacSha256Base64url(stateSecret, encodedPayload);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return safeRedirect(`${genericErrorRedirect}&reason=bad_state_sig`);
    }

    const payloadText = base64urlToString(encodedPayload);
    const payloadUnknown: unknown = JSON.parse(payloadText) as unknown;

    if (!isRecord(payloadUnknown)) return safeRedirect(`${genericErrorRedirect}&reason=bad_state_payload`);

    const integrationId = pickString(payloadUnknown, 'integrationId').trim();
    const workspaceId = pickString(payloadUnknown, 'workspaceId').trim();
    const iat = pickNumber(payloadUnknown, 'iat');
    const ttl = pickNumber(payloadUnknown, 'ttl') ?? 900;

    if (!integrationId || !workspaceId || !isUuid(integrationId) || !isUuid(workspaceId) || !iat) {
      return safeRedirect(`${genericErrorRedirect}&reason=bad_state_fields`);
    }

    const configRedirectBase = baseUrl
      ? `${baseUrl}/integrations/meta/${integrationId}`
      : `/integrations/meta/${integrationId}`;

    // ✅ Si el usuario canceló/denegó permisos
    if (metaErr) {
      const reason = metaErrReason || metaErr;
      const msg = metaErrDesc || 'OAuth cancelado o denegado.';
      return safeRedirect(
        `${configRedirectBase}?oauth=cancelled&reason=${encodeURIComponent(reason)}&message=${encodeURIComponent(msg)}`
      );
    }

    if (!code) {
      return safeRedirect(`${configRedirectBase}?oauth=error&reason=missing_code`);
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > iat + ttl) {
      return safeRedirect(`${configRedirectBase}?oauth=error&reason=state_expired`);
    }

    const redirectUri = `${baseUrl}/api/integrations/meta/oauth/callback`;

    // Exchange code -> short-lived token
    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', metaAppId);
    tokenUrl.searchParams.set('client_secret', metaAppSecret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenRaw = await fetchJson(tokenUrl.toString());
    const tokenParsed: MetaTokenResponse = isRecord(tokenRaw)
      ? {
          access_token: typeof tokenRaw.access_token === 'string' ? tokenRaw.access_token : undefined,
          token_type: typeof tokenRaw.token_type === 'string' ? tokenRaw.token_type : undefined,
          expires_in: typeof tokenRaw.expires_in === 'number' ? tokenRaw.expires_in : undefined,
        }
      : {};

    let accessToken = tokenParsed.access_token ?? '';
    let tokenType = tokenParsed.token_type ?? 'bearer';
    let expiresIn = tokenParsed.expires_in ?? null;

    if (!accessToken) {
      return safeRedirect(`${configRedirectBase}?oauth=error&reason=missing_access_token`);
    }

    // Optional: exchange to long-lived token
    if (exchangeLongLived) {
      const llUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
      llUrl.searchParams.set('grant_type', 'fb_exchange_token');
      llUrl.searchParams.set('client_id', metaAppId);
      llUrl.searchParams.set('client_secret', metaAppSecret);
      llUrl.searchParams.set('fb_exchange_token', accessToken);

      const llRaw = await fetchJson(llUrl.toString());
      if (isRecord(llRaw)) {
        const llToken = typeof llRaw.access_token === 'string' ? llRaw.access_token : '';
        const llType = typeof llRaw.token_type === 'string' ? llRaw.token_type : tokenType;
        const llExpires = typeof llRaw.expires_in === 'number' ? llRaw.expires_in : expiresIn;

        if (llToken) {
          accessToken = llToken;
          tokenType = llType;
          expiresIn = llExpires;
        }
      }
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Ensure integration exists and belongs to workspace and provider=meta
    const { data: row, error: fetchErr } = await admin
      .from('integrations')
      .select('id, workspace_id, provider')
      .eq('id', integrationId)
      .eq('workspace_id', workspaceId)
      .limit(1)
      .maybeSingle();

    if (fetchErr || !row || row.provider !== 'meta') {
      return safeRedirect(`${configRedirectBase}?oauth=error&reason=integration_not_found`);
    }

    // ✅ NEW: cifrar token + guardar en integration_oauth_tokens
    const accessTokenCiphertext = encryptToken(accessToken);

    const expiresAt =
      typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null;

    const { error: tokErr } = await admin
      .from('integration_oauth_tokens')
      .upsert(
        {
          integration_id: integrationId,
          workspace_id: workspaceId,
          provider: 'meta',
          access_token_ciphertext: accessTokenCiphertext,
          refresh_token_ciphertext: null,
          token_type: tokenType,
          scopes: null,
          expires_at: expiresAt,
          obtained_at: new Date().toISOString(),
        },
        { onConflict: 'integration_id,provider' }
      );

    if (tokErr) {
      return safeRedirect(`${configRedirectBase}?oauth=error&reason=token_store_failed`);
    }

    // ✅ Marcar integración como conectada (sin guardar token en integrations.secrets)
    const { error: updErr } = await admin
      .from('integrations')
      .update({
        status: 'connected',
        secrets: {}, // mantenemos vacío para no duplicar
        config: { connected: true, provider: 'meta' },
      })
      .eq('id', integrationId)
      .eq('workspace_id', workspaceId);

    if (updErr) {
      return safeRedirect(`${configRedirectBase}?oauth=error&reason=db_update_failed`);
    }

    // ✅ IMPORTANTE: tu UI escucha oauth=success
    return safeRedirect(`${configRedirectBase}?oauth=success`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    const fallback = baseUrl
      ? `${baseUrl}/integrations?oauth=error&reason=exception`
      : '/integrations?oauth=error&reason=exception';
    return NextResponse.redirect(fallback + `&msg=${encodeURIComponent(msg.slice(0, 200))}`);
  }
}
