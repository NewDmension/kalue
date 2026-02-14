// src/app/api/webhooks/meta/route.ts
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

import { decryptToken } from '@/server/crypto/tokenCrypto';

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

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '{"error":"stringify_failed"}';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getString(obj: unknown, key: string): string | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyMetaSignatureSha256(args: { appSecret: string; rawBody: Buffer; header: string | null }): boolean {
  if (!args.header) return false;
  const prefix = 'sha256=';
  if (!args.header.startsWith(prefix)) return false;

  const theirHex = args.header.slice(prefix.length).trim();
  if (!/^[0-9a-f]{64}$/i.test(theirHex)) return false;

  const ours = crypto.createHmac('sha256', args.appSecret).update(args.rawBody).digest('hex');
  return timingSafeEqualHex(ours, theirHex);
}

function verifyMetaSignatureSha1(args: { appSecret: string; rawBody: Buffer; header: string | null }): boolean {
  if (!args.header) return false;
  const prefix = 'sha1=';
  if (!args.header.startsWith(prefix)) return false;

  const theirHex = args.header.slice(prefix.length).trim();
  if (!/^[0-9a-f]{40}$/i.test(theirHex)) return false;

  const ours = crypto.createHmac('sha1', args.appSecret).update(args.rawBody).digest('hex');
  return timingSafeEqualHex(ours, theirHex);
}

function verifyMetaSignature(args: {
  appSecret: string;
  rawBody: Buffer;
  headerSha256: string | null;
  headerSha1: string | null;
}): { ok: boolean; algo: 'sha256' | 'sha1' | 'none' } {
  if (verifyMetaSignatureSha256({ appSecret: args.appSecret, rawBody: args.rawBody, header: args.headerSha256 })) {
    return { ok: true, algo: 'sha256' };
  }
  if (verifyMetaSignatureSha1({ appSecret: args.appSecret, rawBody: args.rawBody, header: args.headerSha1 })) {
    return { ok: true, algo: 'sha1' };
  }
  return { ok: false, algo: 'none' };
}

/** Meta webhook payload (leadgen) */
type MetaWebhook = {
  object?: string;
  entry?: Array<{
    id?: string; // page_id
    time?: number;
    changes?: Array<{
      field?: string; // "leadgen"
      value?: {
        leadgen_id?: string;
        form_id?: string;
        page_id?: string;
        created_time?: number;
      };
    }>;
  }>;
};

type GraphError = { message?: string; type?: string; code?: number; fbtrace_id?: string };

type GraphAccountsItem = {
  id?: unknown;
  name?: unknown;
  access_token?: unknown;
};

type GraphAccountsResp = {
  data?: GraphAccountsItem[];
  error?: GraphError;
};

type GraphLeadResp = {
  id?: unknown;
  created_time?: unknown;
  field_data?: unknown;
  error?: GraphError;
};

type MetaPageToken = {
  page_id: string;
  page_name: string | null;
  page_access_token: string;
};

async function safeGraphJson<T extends Record<string, unknown>>(
  res: Response
): Promise<{ raw: unknown; parsed: T }> {
  const text = await res.text();
  let raw: unknown = null;
  try {
    raw = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    raw = { _nonJson: true, text };
  }
  const parsed = (isRecord(raw) ? (raw as T) : ({} as T));
  return { raw, parsed };
}

async function graphGet<T extends Record<string, unknown>>(url: string, userAccessToken: string) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${userAccessToken}`,
    },
    cache: 'no-store',
  });
  const { raw, parsed } = await safeGraphJson<T>(res);
  return { res, raw, parsed };
}

async function fetchPageAccessToken(args: {
  graphVersion: string;
  userAccessToken: string;
  pageId: string;
}): Promise<MetaPageToken> {
  const url = new URL(`https://graph.facebook.com/${args.graphVersion}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token');
  url.searchParams.set('limit', '200');
  url.searchParams.set('access_token', args.userAccessToken);

  const r = await graphGet<GraphAccountsResp>(url.toString(), args.userAccessToken);
  if (!r.res.ok) {
    throw new Error(`page_token_fetch_failed:${safeJsonStringify(r.raw)}`);
  }

  const items = Array.isArray(r.parsed.data) ? r.parsed.data : [];
  for (const it of items) {
    const id = typeof it.id === 'string' ? it.id : null;
    if (!id) continue;
    if (id !== args.pageId) continue;

    const tok = typeof it.access_token === 'string' ? it.access_token : null;
    if (!tok) break;

    const name = typeof it.name === 'string' ? it.name : null;
    return { page_id: id, page_name: name, page_access_token: tok };
  }

  throw new Error('page_token_not_found_in_me_accounts');
}

async function fetchLeadDetails(args: {
  graphVersion: string;
  leadgenId: string;
  pageAccessToken: string;
}): Promise<unknown> {
  const fields = ['created_time', 'field_data'].join(',');

  const url = new URL(`https://graph.facebook.com/${args.graphVersion}/${encodeURIComponent(args.leadgenId)}`);
  url.searchParams.set('access_token', args.pageAccessToken);
  url.searchParams.set('fields', fields);

  const res = await fetch(url.toString(), { method: 'GET', cache: 'no-store' });
  const { raw } = await safeGraphJson<GraphLeadResp>(res);

  if (!res.ok) throw new Error(`lead_fetch_failed:${safeJsonStringify(raw)}`);
  return raw;
}

function extractLeadFields(metaLead: unknown): { full_name: string | null; email: string | null; phone: string | null } {
  if (!isRecord(metaLead)) return { full_name: null, email: null, phone: null };

  const fieldData = metaLead['field_data'];
  if (!Array.isArray(fieldData)) return { full_name: null, email: null, phone: null };

  const pick = (names: string[]): string | null => {
    for (const item of fieldData) {
      if (!isRecord(item)) continue;
      const n = getString(item, 'name');
      if (!n) continue;
      if (!names.includes(n)) continue;

      const values = item['values'];
      if (Array.isArray(values) && typeof values[0] === 'string') return values[0];
    }
    return null;
  };

  return {
    full_name: pick(['full_name', 'name']),
    email: pick(['email']),
    phone: pick(['phone_number', 'phone']),
  };
}

function buildVerifyToken(): string {
  return getEnvOptional('META_VERIFY_TOKEN') || getEnvOptional('META_WEBHOOK_VERIFY_TOKEN') || '';
}

async function logWebhookEvent(args: {
  admin: SupabaseClient;
  provider: string;
  workspaceId: string | null;
  integrationId: string | null;
  eventType: string | null;
  objectId: string | null;
  payload: unknown;
}): Promise<void> {
  await args.admin.from('integration_webhook_events').insert({
    provider: args.provider,
    workspace_id: args.workspaceId,
    integration_id: args.integrationId,
    event_type: args.eventType,
    object_id: args.objectId,
    payload: args.payload,
  });
}

/**
 * ✅ Tabla válida para match:
 * integration_meta_mappings
 * Campos clave: workspace_id, integration_id, page_id, activo
 */
type MappingRow = {
  workspace_id: string;
  integration_id: string;
  page_id: string;
  status: string | null;
  webhook_subscribed: boolean | null;
};

async function resolveMappingByPage(args: {
  admin: SupabaseClient;
  pageId: string;
}): Promise<MappingRow | null> {
  const { data, error } = await args.admin
  .from('integration_meta_mappings')
  .select('workspace_id, integration_id, page_id, status, webhook_subscribed')
  .eq('page_id', args.pageId)
  .eq('status', 'active')
  .limit(1)
  .maybeSingle();

  if (error) return null;
  return data ? (data as MappingRow) : null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe') {
    const verifyToken = buildVerifyToken();
    if (!verifyToken) return new NextResponse('Missing verify token', { status: 500 });

    if (token === verifyToken && typeof challenge === 'string') {
      return new NextResponse(challenge, { status: 200 });
    }
    return new NextResponse('Forbidden', { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    route: '/api/webhooks/meta',
    ts: new Date().toISOString(),
    note: 'Meta verification uses hub.* query params. POST expects x-hub-signature-256 (sha256) or x-hub-signature (sha1).',
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const appSecret = getEnv('META_APP_SECRET');
  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const raw = Buffer.from(await req.arrayBuffer());

  // Meta puede enviar sha256 o sha1 según configuración/version
  const sig256 = req.headers.get('x-hub-signature-256');
  const sig1 = req.headers.get('x-hub-signature');

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const verified = verifyMetaSignature({ appSecret, rawBody: raw, headerSha256: sig256, headerSha1: sig1 });

  if (!verified.ok) {
    try {
      await logWebhookEvent({
        admin: supabaseAdmin,
        provider: 'meta',
        workspaceId: null,
        integrationId: null,
        eventType: 'invalid_signature',
        objectId: null,
        payload: {
          has_signature_256: Boolean(sig256),
          has_signature_sha1: Boolean(sig1),
          body_bytes: raw.length,
          body_sha256: crypto.createHash('sha256').update(raw).digest('hex'),
        },
      });
    } catch {
      // no-op
    }
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const payload = body as MetaWebhook;
  const graphVersion = (process.env.META_GRAPH_VERSION?.trim() || 'v20.0').replace(/^v/i, 'v');

  // Auditoría (ya con firma OK)
  try {
    await logWebhookEvent({
      admin: supabaseAdmin,
      provider: 'meta',
      workspaceId: null,
      integrationId: null,
      eventType: 'raw',
      objectId: payload.object ?? null,
      payload: { ...((isRecord(body) ? body : {}) as Json), _sig_algo: verified.algo },
    });
  } catch {
    // no-op
  }

  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const e of entries) {
    const pageIdFromEntry = typeof e.id === 'string' ? e.id : null;
    const changes = Array.isArray(e.changes) ? e.changes : [];

    for (const c of changes) {
      if (c.field !== 'leadgen') continue;

      const leadgenId = c.value?.leadgen_id ?? null;
      const formId = c.value?.form_id ?? null;
      const pageId = c.value?.page_id ?? pageIdFromEntry;

      if (!pageId) {
        try {
          await logWebhookEvent({
            admin: supabaseAdmin,
            provider: 'meta',
            workspaceId: null,
            integrationId: null,
            eventType: 'leadgen_missing_page_id',
            objectId: leadgenId,
            payload: { entry: e, change: c },
          });
        } catch {
          // no-op
        }
        continue;
      }

      // ✅ Matching real: solo page_id + subscribed=true (tu tabla)
     const mapping = await resolveMappingByPage({ admin: supabaseAdmin, pageId });


     if (!mapping?.workspace_id || !mapping?.integration_id) {

        try {
          await logWebhookEvent({
            admin: supabaseAdmin,
            provider: 'meta',
            workspaceId: null,
            integrationId: null,
            eventType: 'webhook_unmatched',
            objectId: leadgenId,
            payload: { page_id: pageId, form_id: formId, leadgen_id: leadgenId },
          });
        } catch {
          // no-op
        }
        continue;
      }

      const workspaceId = String(mapping.workspace_id);
const integrationId = String(mapping.integration_id);


      try {
        await logWebhookEvent({
          admin: supabaseAdmin,
          provider: 'meta',
          workspaceId,
          integrationId,
          eventType: 'leadgen',
          objectId: leadgenId,
          payload: { page_id: pageId, form_id: formId, leadgen_id: leadgenId },
        });
      } catch {
        // no-op
      }

      // token del usuario (cifrado) de esta integración
      const { data: tok, error: tokErr } = await supabaseAdmin
        .from('integration_oauth_tokens')
        .select('access_token_ciphertext')
        .eq('workspace_id', workspaceId)
        .eq('integration_id', integrationId)
        .eq('provider', 'meta')
        .maybeSingle();

      if (tokErr || !tok?.access_token_ciphertext) {
        try {
          await logWebhookEvent({
            admin: supabaseAdmin,
            provider: 'meta',
            workspaceId,
            integrationId,
            eventType: 'error',
            objectId: leadgenId,
            payload: { reason: 'oauth_token_not_found', page_id: pageId, form_id: formId },
          });
        } catch {
          // no-op
        }
        continue;
      }

      let userAccessToken = '';
      try {
        userAccessToken = decryptToken(String(tok.access_token_ciphertext));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'decrypt_failed';
        try {
          await logWebhookEvent({
            admin: supabaseAdmin,
            provider: 'meta',
            workspaceId,
            integrationId,
            eventType: 'error',
            objectId: leadgenId,
            payload: { reason: 'decrypt_failed', message: msg },
          });
        } catch {
          // no-op
        }
        continue;
      }

      // page access token
      let pageAccessToken = '';
      let pageName: string | null = null;

      try {
        const pageTok = await fetchPageAccessToken({ graphVersion, userAccessToken, pageId });
        pageAccessToken = pageTok.page_access_token;
        pageName = pageTok.page_name;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'page_token_fetch_failed';
        try {
          await logWebhookEvent({
            admin: supabaseAdmin,
            provider: 'meta',
            workspaceId,
            integrationId,
            eventType: 'error',
            objectId: leadgenId,
            payload: { reason: 'page_token_fetch_failed', page_id: pageId, form_id: formId, message: msg },
          });
        } catch {
          // no-op
        }
        continue;
      }

      // fetch lead
      try {
        if (!leadgenId) continue;

        const metaLead = await fetchLeadDetails({ graphVersion, leadgenId, pageAccessToken });
        const extracted = extractLeadFields(metaLead);

        try {
          await logWebhookEvent({
            admin: supabaseAdmin,
            provider: 'meta',
            workspaceId,
            integrationId,
            eventType: 'lead_fetched',
            objectId: leadgenId,
            payload: { leadgen_id: leadgenId, page_id: pageId, page_name: pageName, form_id: formId, extracted },
          });
        } catch {
          // no-op
        }

        // Aquí ya insertaremos el lead en tu tabla final cuando dejemos “Fase leads” lista.
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'lead_process_failed';
        try {
          await logWebhookEvent({
            admin: supabaseAdmin,
            provider: 'meta',
            workspaceId,
            integrationId,
            eventType: 'error',
            objectId: leadgenId,
            payload: { reason: 'lead_process_failed', leadgen_id: leadgenId, message: msg },
          });
        } catch {
          // no-op
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
