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

function safeJsonStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '{"error":"stringify_failed"}';
  }
}

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyMetaSignature(args: { appSecret: string; rawBody: Buffer; header: string | null }): boolean {
  if (!args.header) return false;
  const prefix = 'sha256=';
  if (!args.header.startsWith(prefix)) return false;

  const theirHex = args.header.slice(prefix.length).trim();
  if (!/^[0-9a-f]{64}$/i.test(theirHex)) return false;

  const ours = crypto.createHmac('sha256', args.appSecret).update(args.rawBody).digest('hex');
  return timingSafeEqualHex(ours, theirHex);
}

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getString(obj: unknown, key: string): string | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

async function fetchLeadDetails(args: { leadgenId: string; pageAccessToken: string }): Promise<unknown> {
  const fields = ['created_time', 'field_data'].join(',');

  const url = new URL(`https://graph.facebook.com/v19.0/${encodeURIComponent(args.leadgenId)}`);
  url.searchParams.set('access_token', args.pageAccessToken);
  url.searchParams.set('fields', fields);

  const res = await fetch(url.toString(), { method: 'GET' });
  const json: unknown = await res.json();
  if (!res.ok) throw new Error(`lead_fetch_failed:${safeJsonStringify(json)}`);
  return json;
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

export async function GET(req: Request): Promise<NextResponse> {
  // ✅ 1) Verificación oficial de Meta (hub.challenge)
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe') {
    const verifyToken = getEnv('META_VERIFY_TOKEN');
    if (token === verifyToken && typeof challenge === 'string') {
      return new NextResponse(challenge, { status: 200 });
    }
    return new NextResponse('Forbidden', { status: 403 });
  }

  // ✅ 2) Debug / salud: para que al abrir en navegador NO parezca "roto"
  return NextResponse.json({
    ok: true,
    route: '/api/webhooks/meta',
    ts: new Date().toISOString(),
    note: 'This is a health response. Meta verification uses hub.* query params.',
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const appSecret = getEnv('META_APP_SECRET');
  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const raw = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get('x-hub-signature-256');

  const ok = verifyMetaSignature({ appSecret, rawBody: raw, header: signature });
  if (!ok) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8')) as unknown;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const payload = body as MetaWebhook;
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const entry = Array.isArray(payload.entry) ? payload.entry : [];

  for (const e of entry) {
    const pageId = typeof e.id === 'string' ? e.id : null;
    if (!pageId) continue;

    const changes = Array.isArray(e.changes) ? e.changes : [];

    const { data: integration, error: intErr } = await supabaseAdmin
      .from('integrations')
      .select('id, workspace_id, config, secrets')
      .eq('provider', 'meta')
      .contains('config', { page_id: pageId } as Json)
      .maybeSingle();

    if (integration?.workspace_id) {
      await supabaseAdmin.from('integration_events').insert({
        workspace_id: integration.workspace_id,
        integration_id: integration.id,
        provider: 'meta',
        type: 'webhook_received',
        payload: { page_id: pageId } as Json,
      });
    }

    if (intErr || !integration) continue;

    const secrets = isRecord(integration.secrets) ? integration.secrets : {};
    const pageAccessToken = typeof secrets['page_access_token'] === 'string' ? secrets['page_access_token'] : null;

    if (!pageAccessToken) {
      await supabaseAdmin.from('integration_events').insert({
        workspace_id: integration.workspace_id,
        integration_id: integration.id,
        provider: 'meta',
        type: 'error',
        payload: { reason: 'missing_page_access_token', page_id: pageId } as Json,
      });
      continue;
    }

    for (const c of changes) {
      if (c.field !== 'leadgen') continue;
      const leadgenId = c.value?.leadgen_id;
      if (!leadgenId) continue;

      try {
        const metaLead = await fetchLeadDetails({ leadgenId, pageAccessToken });
        const extracted = extractLeadFields(metaLead);

        const { error: insErr } = await supabaseAdmin.from('leads').upsert(
          {
            workspace_id: integration.workspace_id,
            integration_id: integration.id,
            source: 'meta',
            external_id: leadgenId,
            full_name: extracted.full_name,
            email: extracted.email,
            phone: extracted.phone,
          },
          { onConflict: 'workspace_id,source,external_id' }
        );

        if (insErr) {
          await supabaseAdmin.from('integration_events').insert({
            workspace_id: integration.workspace_id,
            integration_id: integration.id,
            provider: 'meta',
            type: 'error',
            payload: { reason: 'lead_upsert_failed', leadgen_id: leadgenId } as Json,
          });
          continue;
        }

        await supabaseAdmin.from('integration_events').insert({
          workspace_id: integration.workspace_id,
          integration_id: integration.id,
          provider: 'meta',
          type: 'lead_imported',
          payload: { leadgen_id: leadgenId } as Json,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown_error';
        await supabaseAdmin.from('integration_events').insert({
          workspace_id: integration.workspace_id,
          integration_id: integration.id,
          provider: 'meta',
          type: 'error',
          payload: { reason: 'lead_process_failed', leadgen_id: leadgenId, message: msg } as Json,
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
