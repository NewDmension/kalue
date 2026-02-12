// src/app/api/integrations/meta/oauth/callback/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Json = Record<string, unknown>;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickString(v: unknown, key: string): string {
  if (!isRecord(v)) return '';
  const x = v[key];
  return typeof x === 'string' ? x : '';
}

function getBaseUrl(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (!host) throw new Error('Missing host header');
  return `${proto}://${host}`;
}

function htmlResponse(html: string): NextResponse {
  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * Devuelve una mini página que:
 * - avisa a la ventana padre (window.opener) con postMessage
 * - intenta cerrarse
 * - si no puede, muestra botón "Cerrar"
 */
function buildPopupCloseHtml(args: {
  ok: boolean;
  origin: string;
  payload: Record<string, unknown>;
  title?: string;
  subtitle?: string;
}): string {
  const safeTitle = (args.title ?? (args.ok ? 'Conexión completada' : 'No se pudo completar la conexión'))
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const safeSubtitle = (args.subtitle ?? (args.ok ? 'Ya puedes volver a Kalue.' : 'Revisa permisos o vuelve a intentar.'))
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const payloadJson = JSON.stringify(args.payload);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #0b0b10; color: #fff; }
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { width: 100%; max-width: 520px; border-radius: 16px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); padding: 20px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { font-size: 14px; opacity: 0.85; margin: 0 0 16px; line-height: 1.4; }
    button { width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(99,102,241,0.30); background: rgba(99,102,241,0.12); color: #fff; font-weight: 600; cursor: pointer; }
    .small { font-size: 12px; opacity: 0.7; margin-top: 12px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; opacity: 0.85; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>${safeTitle}</h1>
      <p>${safeSubtitle}</p>
      <button id="closeBtn" type="button">Cerrar ventana</button>
      <div class="small">Si esta ventana no se cierra automáticamente, pulsa “Cerrar ventana”.</div>
      <div class="small">Origen: <code>${args.origin}</code></div>
    </div>
  </div>

  <script>
    (function() {
      var ORIGIN = ${JSON.stringify(args.origin)};
      var payload = ${payloadJson};

      try {
        if (window.opener && typeof window.opener.postMessage === 'function') {
          window.opener.postMessage(payload, ORIGIN);
        }
      } catch (e) {}

      function tryClose() {
        try { window.close(); } catch (e) {}
      }

      // Intento inmediato + reintento corto
      tryClose();
      setTimeout(tryClose, 150);

      document.getElementById('closeBtn')?.addEventListener('click', function() {
        tryClose();
      });
    })();
  </script>
</body>
</html>`;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

    const stateSecret = requireEnv('META_OAUTH_STATE_SECRET');
    const metaAppId = requireEnv('META_APP_ID');
    const metaAppSecret = requireEnv('META_APP_SECRET'); // asegúrate de tenerla en Vercel
    const graphVersion = getEnv('META_GRAPH_VERSION', 'v20.0');

    const url = new URL(req.url);

    const code = url.searchParams.get('code') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const error = url.searchParams.get('error') ?? '';
    const errorDescription = url.searchParams.get('error_description') ?? '';

    const origin = getBaseUrl(req);

    // Si Meta devuelve error
    if (error) {
      const payload = {
        type: 'KALUE_META_OAUTH_RESULT',
        ok: false,
        error,
        errorDescription,
      };

      return htmlResponse(
        buildPopupCloseHtml({
          ok: false,
          origin,
          payload,
          title: 'Conexión cancelada',
          subtitle: errorDescription || 'Se canceló o falló la autorización en Meta.',
        })
      );
    }

    if (!code || !state) {
      const payload = {
        type: 'KALUE_META_OAUTH_RESULT',
        ok: false,
        error: 'missing_code_or_state',
      };

      return htmlResponse(
        buildPopupCloseHtml({
          ok: false,
          origin,
          payload,
          title: 'Error de conexión',
          subtitle: 'Faltan parámetros del callback (code/state).',
        })
      );
    }

    // Validar state (firma + ttl)
    const parts = state.split('.');
    if (parts.length !== 2) {
      const payload = { type: 'KALUE_META_OAUTH_RESULT', ok: false, error: 'invalid_state_format' };
      return htmlResponse(buildPopupCloseHtml({ ok: false, origin, payload, title: 'Error de conexión' }));
    }

    const encodedPayload = parts[0] ?? '';
    const sig = parts[1] ?? '';
    const expectedSig = hmacSha256Base64url(stateSecret, encodedPayload);

    if (sig !== expectedSig) {
      const payload = { type: 'KALUE_META_OAUTH_RESULT', ok: false, error: 'invalid_state_signature' };
      return htmlResponse(buildPopupCloseHtml({ ok: false, origin, payload, title: 'Error de conexión' }));
    }

    const payloadStr = base64urlToString(encodedPayload);
    let stateObj: unknown = null;
    try {
      stateObj = JSON.parse(payloadStr) as unknown;
    } catch {
      stateObj = null;
    }

    const integrationId = pickString(stateObj, 'integrationId');
    const workspaceId = pickString(stateObj, 'workspaceId');
    const iat = Number(pickString(stateObj, 'iat') || '0');
    const ttl = Number(pickString(stateObj, 'ttl') || '0');

    if (!integrationId || !workspaceId || !iat || !ttl) {
      const payload = { type: 'KALUE_META_OAUTH_RESULT', ok: false, error: 'invalid_state_payload' };
      return htmlResponse(buildPopupCloseHtml({ ok: false, origin, payload, title: 'Error de conexión' }));
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > iat + ttl) {
      const payload = { type: 'KALUE_META_OAUTH_RESULT', ok: false, error: 'state_expired' };
      return htmlResponse(buildPopupCloseHtml({ ok: false, origin, payload, title: 'Estado expirado' }));
    }

    // 1) Intercambio code -> access_token
    const redirectUri = `${origin}/api/integrations/meta/oauth/callback`;

    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', metaAppId);
    tokenUrl.searchParams.set('client_secret', metaAppSecret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);

    const tokenRes = await fetch(tokenUrl.toString(), { method: 'GET' });
    const tokenJson: unknown = await tokenRes.json();

    if (!tokenRes.ok) {
      const payload = {
        type: 'KALUE_META_OAUTH_RESULT',
        ok: false,
        error: 'token_exchange_failed',
        detail: tokenJson,
      };
      return htmlResponse(
        buildPopupCloseHtml({
          ok: false,
          origin,
          payload,
          title: 'Error de conexión',
          subtitle: 'No se pudo completar el intercambio del token.',
        })
      );
    }

    const accessToken = isRecord(tokenJson) && typeof tokenJson['access_token'] === 'string' ? tokenJson['access_token'] : '';
    if (!accessToken) {
      const payload = { type: 'KALUE_META_OAUTH_RESULT', ok: false, error: 'missing_access_token' };
      return htmlResponse(buildPopupCloseHtml({ ok: false, origin, payload, title: 'Error de conexión' }));
    }

    // 2) Guardar token cifrado en Supabase (aquí asumo que tú ya tienes encryptToken/decryptToken en server)
    // ⚠️ Si tu cifrado está en otro helper, reemplaza este bloque.
    // Para no romperte ahora, guardo en texto plano SOLO si no tienes helper (pero NO recomendado).
    // -----
    // ✅ RECOMENDADO: import { encryptToken } from '@/server/crypto/encryptToken';
    // const access_token_ciphertext = encryptToken(accessToken);
    // -----

    // ⚠️ Placeholder: cambia por TU cifrado real
    const access_token_ciphertext = accessToken;

    const admin: SupabaseClient = createClient(supabaseUrl, serviceKey);

    const { error: upsertErr } = await admin.from('integration_oauth_tokens').upsert(
      {
        workspace_id: workspaceId,
        integration_id: integrationId,
        provider: 'meta',
        access_token_ciphertext,
      },
      { onConflict: 'workspace_id,integration_id,provider' }
    );

    if (upsertErr) {
      const payload = { type: 'KALUE_META_OAUTH_RESULT', ok: false, error: 'db_upsert_failed' };
      return htmlResponse(buildPopupCloseHtml({ ok: false, origin, payload, title: 'Error guardando token' }));
    }

    // 3) Marcar integración como connected
    await admin
      .from('integrations')
      .update({ status: 'connected', last_error: null, updated_at: new Date().toISOString() })
      .eq('id', integrationId)
      .eq('workspace_id', workspaceId);

    const payload = {
      type: 'KALUE_META_OAUTH_RESULT',
      ok: true,
      integrationId,
      workspaceId,
    };

    return htmlResponse(
      buildPopupCloseHtml({
        ok: true,
        origin,
        payload,
        title: 'Conexión completada',
        subtitle: 'Puedes volver a Kalue. Esta ventana se cerrará sola.',
      })
    );
  } catch (e: unknown) {
    const origin = (() => {
      try {
        return getBaseUrl(req);
      } catch {
        return '';
      }
    })();

    const msg = e instanceof Error ? e.message : 'Unexpected error';
    const payload = { type: 'KALUE_META_OAUTH_RESULT', ok: false, error: 'server_error', detail: msg };

    // Si no podemos calcular origin, igual mostramos algo cerrable
    const safeOrigin = origin || 'https://example.com';

    return htmlResponse(
      buildPopupCloseHtml({
        ok: false,
        origin: safeOrigin,
        payload,
        title: 'Error de servidor',
        subtitle: msg,
      })
    );
  }
}
