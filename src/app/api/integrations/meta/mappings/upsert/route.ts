// src/app/api/integrations/meta/mappings/upsert/route.ts
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getBearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
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

function pickString(v: unknown, key: string): string {
  if (!isRecord(v)) return '';
  const x = v[key];
  return typeof x === 'string' ? x.trim() : '';
}

function pickArray(v: unknown, key: string): unknown[] {
  if (!isRecord(v)) return [];
  const x = v[key];
  return Array.isArray(x) ? x : [];
}

type FormInput = { formId: string; formName: string | null };

function parseForms(raw: unknown): FormInput[] {
  if (!Array.isArray(raw)) return [];
  const out: FormInput[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const formId = typeof item.formId === 'string' ? item.formId.trim() : '';
    if (!formId) continue;
    const formName =
      typeof item.formName === 'string' && item.formName.trim().length > 0 ? item.formName.trim() : null;
    out.push({ formId, formName });
  }
  return out;
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

type MappingRow = {
  id: string;
  workspace_id: string;
  integration_id: string;
  page_id: string;
  page_name: string | null;
  form_id: string | null;
  form_name: string | null;
  status: string;
  webhook_subscribed: boolean;
  subscribed_at: string | null;
  updated_at: string | null;
};

function chunk<T>(arr: T[], size: number): T[][];
function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearer(req);
    if (!token) return json(401, { error: 'login_required' });

    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!workspaceId) return json(400, { error: 'missing_workspace_id' });

    const body = await safeJson(req);

    const integrationId = pickString(body, 'integrationId');
    const pageId = pickString(body, 'pageId');
    const pageNameRaw = pickString(body, 'pageName');
    const pageName = pageNameRaw ? pageNameRaw : null;

    const formsArr = pickArray(body, 'forms');
    const forms = parseForms(formsArr);

    if (!integrationId) return json(400, { error: 'missing_integrationId' });
    if (!pageId) return json(400, { error: 'missing_pageId' });
    if (forms.length === 0) return json(400, { error: 'missing_forms' });

    // Auth user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const userId = await getAuthedUserId(userClient);
    if (!userId) return json(401, { error: 'login_required' });

    // Admin
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ok = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!ok) return json(403, { error: 'not_member' });

    const nowIso = new Date().toISOString();

    // Importante: onConflict debe corresponder a un UNIQUE REAL en Postgres.
    // Como tienes índices parciales (form_id IS NOT NULL), hacemos UPSERT en dos grupos:
    // - con form_id (multi-form)
    // - sin form_id (preparado para el futuro)
    const withForm = forms.map((f) => ({
      workspace_id: workspaceId,
      integration_id: integrationId,
      provider: 'meta',
      page_id: pageId,
      page_name: pageName,
      form_id: f.formId,
      form_name: f.formName,
      status: 'draft',
      webhook_subscribed: false,
      subscribed_at: null,
      last_error: null,
      updated_at: nowIso,
    }));

    // Nota: hoy tu UI no manda “sin form”. Esto es por si mañana soportas “page mapping sin form”.
    const withoutForm: Array<{
      workspace_id: string;
      integration_id: string;
      provider: 'meta';
      page_id: string;
      page_name: string | null;
      form_id: null;
      form_name: null;
      status: 'draft';
      webhook_subscribed: false;
      subscribed_at: null;
      last_error: null;
      updated_at: string;
    }> = [];

    const results: MappingRow[] = [];

    // Upsert “con form”
    if (withForm.length > 0) {
      // por seguridad en payloads grandes
      const batches = chunk(withForm, 50);
      for (const batch of batches) {
        const { data, error } = await admin
          .from('integration_meta_mappings')
          .upsert(batch, { onConflict: 'workspace_id,integration_id,page_id,form_id' })
          .select(
            'id, workspace_id, integration_id, page_id, page_name, form_id, form_name, status, webhook_subscribed, subscribed_at, updated_at',
          );

        if (error) {
          return json(500, {
            error: 'db_error',
            detail: error.message,
            hint:
              'Si falla por unique constraint / onConflict, aplica los índices parciales (multi-form) en integration_meta_mappings.',
          });
        }

        if (Array.isArray(data)) results.push(...(data as unknown as MappingRow[]));
      }
    }

    // Upsert “sin form” (si algún día lo usas)
    if (withoutForm.length > 0) {
      const { data, error } = await admin
        .from('integration_meta_mappings')
        .upsert(withoutForm, { onConflict: 'workspace_id,integration_id,page_id' })
        .select(
          'id, workspace_id, integration_id, page_id, page_name, form_id, form_name, status, webhook_subscribed, subscribed_at, updated_at',
        );

      if (error) {
        return json(500, {
          error: 'db_error',
          detail: error.message,
          hint: 'Falta el índice UNIQUE (workspace_id, integration_id, page_id) WHERE form_id IS NULL.',
        });
      }

      if (Array.isArray(data)) results.push(...(data as unknown as MappingRow[]));
    }

    return json(200, { ok: true, count: results.length, mappings: results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { error: 'server_error', detail: msg });
  }
}
