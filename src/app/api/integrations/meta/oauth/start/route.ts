// src/app/api/integrations/meta/oauth/start/route.ts
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function getBearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

async function safeJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickString(v: unknown, key: string): string {
  if (!isRecord(v)) return '';
  const x = v[key];
  return typeof x === 'string' ? x : '';
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

async function getAuthedUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

async function isWorkspaceMember(args: { admin: SupabaseClient; workspaceId: string; userId: string }): Promise<boolean> {
  const { data, error } = await args.admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', args.workspaceId)
    .eq('user_id', args.userId)
    .limit(1);

  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

async function integrationExistsInWorkspace(args: {
  admin: SupabaseClient;
  workspaceId: string;
  integrationId: string;
}): Promise<boolean> {
  const { data, error } = await args.admin
    .from('integrations')
    .select('id, provider')
    .eq('workspace_id', args.workspaceId)
    .eq('id', args.integrationId)
    .limit(1)
    .maybeSingle();

  if (error) return false;
  if (!data) return false;
  return data.provider === 'meta';
}

function base64url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function hmacSha256Base64url(secret: string, payload: string): string {
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64');
  return sig.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function getBaseUrl(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (!host) throw new Error('Missing host header');
  return `${proto}://${host}`;
}

/**
 * ✅ Allowlist de scopes “seguros” para fase 1 (conectar + listar pages).
 * Añadimos business_management para poder sacar Pages vía Business Manager
 * cuando /me/accounts devuelva vacío (caso típico).
 */
const LOGIN_SCOPE_ALLOWLIST = new Set<string>([
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
]);



function normalizeScopes(raw: string): string {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => LOGIN_SCOPE_ALLOWLIST.has(s));

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of items) {
    if (!seen.has(s)) {
      seen.add(s);
      deduped.push(s);
    }
  }

  return deduped.join(',');
}

function ensureRequiredScopes(scopeCsv: string, required: string[]): string {
  const items = scopeCsv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const set = new Set(items);
  for (const r of required) {
    if (!set.has(r)) items.push(r);
  }
  return items.join(',');
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

    const metaAppId = requireEnv('META_APP_ID');
    const stateSecret = requireEnv('META_OAUTH_STATE_SECRET');

    const graphVersion = getEnv('META_GRAPH_VERSION', 'v20.0');

    /**
     * ✅ FASE 1:
     * - No pedimos leads_retrieval ni nada “avanzado”.
     * - Pedimos business_management para el fallback de Pages (Business Manager).
     */
    const scopesRaw = getEnv(
  'META_OAUTH_SCOPES',
  'public_profile,pages_show_list,pages_read_engagement,business_management'
);


    const ttlSeconds = Number.parseInt(getEnv('META_OAUTH_STATE_TTL_SECONDS', '900'), 10);
    const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 900;

    const token = getBearer(req);
    if (!token) return json(401, { error: 'login_required' });

    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!workspaceId) return json(400, { error: 'missing_workspace_id' });
    if (!isUuid(workspaceId)) return json(400, { error: 'invalid_workspace_id' });

    const body = await safeJson(req);
    const integrationIdRaw = pickString(body, 'integrationId').trim();
    if (!integrationIdRaw) return json(400, { error: 'missing_integration_id' });
    if (!isUuid(integrationIdRaw)) return json(400, { error: 'invalid_integration_id' });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const userId = await getAuthedUserId(userClient);
    if (!userId) return json(401, { error: 'login_required' });

    const admin = createClient(supabaseUrl, serviceKey);

    const ok = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!ok) return json(403, { error: 'not_member' });

    const exists = await integrationExistsInWorkspace({ admin, workspaceId, integrationId: integrationIdRaw });
    if (!exists) return json(404, { error: 'integration_not_found' });

    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/api/integrations/meta/oauth/callback`;

    const statePayloadObj = {
      integrationId: integrationIdRaw,
      workspaceId,
      iat: Math.floor(Date.now() / 1000),
      ttl,
      nonce: crypto.randomBytes(12).toString('hex'),
    };

    const statePayload = JSON.stringify(statePayloadObj);
    const encodedPayload = base64url(statePayload);
    const sig = hmacSha256Base64url(stateSecret, encodedPayload);
    const state = `${encodedPayload}.${sig}`;

    let scope = normalizeScopes(scopesRaw);

    // ✅ mínimos reales para listar pages + fallback business manager
  scope = ensureRequiredScopes(scope, [
  'public_profile',
  'pages_show_list',
  'business_management',
]);


    if (!scope) {
      return json(500, { error: 'server_error', detail: 'META_OAUTH_SCOPES resolved to empty scope list.' });
    }

    const authUrl = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
    authUrl.searchParams.set('client_id', metaAppId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scope);

    // ✅ fuerza que Meta vuelva a pedir permisos (al cambiar scopes)
    authUrl.searchParams.set('auth_type', 'rerequest');

    return json(200, { ok: true, url: authUrl.toString(), debug: { redirectUri, scope } });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    return json(500, { error: 'server_error', detail: msg });
  }
}
