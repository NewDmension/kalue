import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { decryptToken } from '@/server/crypto/tokenCrypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function safeString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

async function getUserFromBearer(admin: SupabaseClient, req: Request): Promise<{ userId: string } | null> {
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim() ?? null;
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error) return null;

  const uid = data.user?.id ?? null;
  if (!uid) return null;
  return { userId: uid };
}

type ImportBody = {
  workspace_id: string;
  integration_id: string;
  page_id: string;
  form_id: string;
  limit?: number; // default 25, max 200
};

type MetaFieldDataItem = {
  name?: unknown;
  values?: unknown;
};

type MetaLead = {
  id?: unknown;
  created_time?: unknown;
  field_data?: unknown;
};

type MetaLeadsResp = {
  data?: unknown;
  paging?: unknown;
  error?: unknown;
};

function pickFirst(fieldData: MetaFieldDataItem[], keys: string[]): string | null {
  for (const k of keys) {
    for (const item of fieldData) {
      const name = safeString(item.name)?.toLowerCase() ?? '';
      if (name !== k.toLowerCase()) continue;

      const values = Array.isArray(item.values) ? item.values : [];
      const first = values.length > 0 ? safeString(values[0]) : null;
      if (first) return first;
    }
  }
  return null;
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.replace(/[^\d+]/g, '').trim();
  return s.length >= 6 ? s : null;
}

function normalizeEmail(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  return s.includes('@') ? s : null;
}

function extractLeadFields(metaLead: MetaLead): { full_name: string | null; email: string | null; phone: string | null } {
  const fdRaw = metaLead.field_data;
  const fieldData: MetaFieldDataItem[] = Array.isArray(fdRaw) ? (fdRaw as MetaFieldDataItem[]) : [];

  const full = pickFirst(fieldData, ['full_name', 'name']) ?? null;
  const email = normalizeEmail(pickFirst(fieldData, ['email'])) ?? null;
  const phone =
    normalizePhone(pickFirst(fieldData, ['phone_number', 'phone', 'mobile_phone', 'telephone'])) ?? null;

  return { full_name: full, email, phone };
}

async function fetchPageAccessToken(args: {
  graphVersion: string;
  userAccessToken: string;
  pageId: string;
}): Promise<{ page_access_token: string; page_name: string | null }> {
  const url = new URL(`https://graph.facebook.com/${args.graphVersion}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token');
  url.searchParams.set('limit', '200');
  url.searchParams.set('access_token', args.userAccessToken);

  const res = await fetch(url.toString(), { method: 'GET', cache: 'no-store' });
  const json = (await res.json()) as unknown;

  if (!res.ok) throw new Error(`me_accounts_failed:${JSON.stringify(json)}`);

  const dataArr = isRecord(json) && Array.isArray(json.data) ? (json.data as unknown[]) : [];
  for (const it of dataArr) {
    if (!isRecord(it)) continue;
    const id = safeString(it.id);
    if (!id || id !== args.pageId) continue;

    const tok = safeString(it.access_token);
    if (!tok) break;

    const name = safeString(it.name);
    return { page_access_token: tok, page_name: name };
  }

  throw new Error('page_token_not_found_in_me_accounts');
}

async function logEvent(admin: SupabaseClient, payload: {
  provider: string;
  workspace_id: string | null;
  integration_id: string | null;
  event_type: string;
  object_id: string | null;
  payload: Json;
}): Promise<void> {
  await admin.from('integration_webhook_events').insert({
    provider: payload.provider,
    workspace_id: payload.workspace_id,
    integration_id: payload.integration_id,
    event_type: payload.event_type,
    object_id: payload.object_id,
    payload: payload.payload,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const user = await getUserFromBearer(admin, req);
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

    let body: unknown;
    try {
      body = (await req.json()) as unknown;
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }

    if (!isRecord(body)) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });

    const b = body as Record<string, unknown>;
    const workspace_id = safeString(b.workspace_id);
    const integration_id = safeString(b.integration_id);
    const page_id = safeString(b.page_id);
    const form_id = safeString(b.form_id);

    const limitRaw = b.limit;
    const limit =
      typeof limitRaw === 'number' && Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(200, limitRaw))
        : 25;

    if (!workspace_id || !integration_id || !page_id || !form_id) {
      return NextResponse.json(
        { ok: false, error: 'missing_required_fields', required: ['workspace_id', 'integration_id', 'page_id', 'form_id'] },
        { status: 400 }
      );
    }

    // 0) seguridad: comprobar que esa subscripción existe y está activa
    const { data: sub, error: subErr } = await admin
      .from('integration_meta_webhook_subscriptions')
      .select('id,status,webhook_subscribed')
      .eq('workspace_id', workspace_id)
      .eq('integration_id', integration_id)
      .eq('provider', 'meta')
      .eq('page_id', page_id)
      .eq('form_id', form_id)
      .limit(1)
      .maybeSingle();

    if (subErr) return NextResponse.json({ ok: false, error: subErr.message }, { status: 500 });
    if (!sub) return NextResponse.json({ ok: false, error: 'subscription_not_found' }, { status: 404 });

    // 1) token cifrado del usuario para esta integración
    const { data: tok, error: tokErr } = await admin
      .from('integration_oauth_tokens')
      .select('access_token_ciphertext')
      .eq('workspace_id', workspace_id)
      .eq('integration_id', integration_id)
      .eq('provider', 'meta')
      .maybeSingle();

    if (tokErr || !tok?.access_token_ciphertext) {
      return NextResponse.json({ ok: false, error: 'oauth_token_not_found' }, { status: 404 });
    }

    let userAccessToken = '';
    try {
      userAccessToken = decryptToken(String(tok.access_token_ciphertext));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'decrypt_failed';
      return NextResponse.json({ ok: false, error: 'decrypt_failed', message: msg }, { status: 500 });
    }

    const graphVersion = (process.env.META_GRAPH_VERSION?.trim() || 'v20.0').replace(/^v/i, 'v');

    // 2) page token (necesario para /{form_id}/leads)
    const pageTok = await fetchPageAccessToken({ graphVersion, userAccessToken, pageId: page_id });
    const pageAccessToken = pageTok.page_access_token;

    // 3) fetch leads del form
    const url = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(form_id)}/leads`);
    url.searchParams.set('access_token', pageAccessToken);
    url.searchParams.set('fields', 'created_time,field_data');
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url.toString(), { method: 'GET', cache: 'no-store' });
    const json = (await res.json()) as unknown;

    if (!res.ok) {
      await logEvent(admin, {
        provider: 'meta',
        workspace_id,
        integration_id,
        event_type: 'import_failed',
        object_id: form_id,
        payload: isRecord(json) ? json : { raw: json },
      });
      return NextResponse.json({ ok: false, error: 'graph_fetch_failed', details: json }, { status: 400 });
    }

    const parsed = isRecord(json) ? (json as MetaLeadsResp) : ({} as MetaLeadsResp);
    const arr = isRecord(parsed) && Array.isArray(parsed.data) ? (parsed.data as unknown[]) : [];

    let imported = 0;
    let skipped = 0;

    for (const it of arr) {
      if (!isRecord(it)) continue;
      const leadId = safeString(it.id);
      if (!leadId) continue;

      const extracted = extractLeadFields(it as MetaLead);

      const leadPayload: Record<string, unknown> = {
        leadgen_id: leadId,
        page_id,
        page_name: pageTok.page_name,
        form_id,
        extracted,
        raw: it,
        imported_via: 'import_route',
      };

      // A) raw storage (integration_leads)
      const { error: insErr } = await admin.from('integration_leads').upsert(
        {
          workspace_id,
          integration_id,
          provider: 'meta',
          external_id: leadId,
          payload: leadPayload,
        },
        { onConflict: 'workspace_id,provider,external_id' }
      );

      if (insErr) {
        skipped += 1;
        continue;
      }

      // B) normalizada (leads)
      await admin.from('leads').upsert(
        {
          workspace_id,
          integration_id,
          source: 'meta',
          external_id: leadId,
          full_name: extracted.full_name,
          email: extracted.email,
          phone: extracted.phone,
        },
        { onConflict: 'workspace_id,source,external_id' }
      );

      imported += 1;
    }

    await logEvent(admin, {
      provider: 'meta',
      workspace_id,
      integration_id,
      event_type: 'import_ok',
      object_id: form_id,
      payload: { imported, skipped, fetched: arr.length, limit },
    });

    // actualizar last_sync_at
    await admin
      .from('integration_meta_webhook_subscriptions')
      .update({ last_sync_at: new Date().toISOString(), last_error: null })
      .eq('workspace_id', workspace_id)
      .eq('integration_id', integration_id)
      .eq('provider', 'meta')
      .eq('page_id', page_id)
      .eq('form_id', form_id);

    return NextResponse.json({ ok: true, imported, skipped });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
