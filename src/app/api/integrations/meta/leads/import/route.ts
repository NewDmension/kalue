import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

type MetaFieldDataItem = {
  name?: string;
  values?: string[];
};

type MetaLead = {
  id: string;
  created_time?: string;
  field_data?: MetaFieldDataItem[];
};

type MetaLeadsPage = {
  data?: MetaLead[];
  paging?: {
    cursors?: { after?: string; before?: string };
    next?: string;
  };
};

type ImportResult = { ok: true; imported: number; skipped: number } | { ok: false; error: string };

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function safeString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function safeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const it of v) {
    const s = safeString(it);
    if (s) out.push(s);
  }
  return out;
}

function pickFirst(fieldData: MetaFieldDataItem[] | undefined, keys: string[]): string | null {
  if (!Array.isArray(fieldData)) return null;

  for (const k of keys) {
    for (const item of fieldData) {
      const name = (item.name ?? '').toLowerCase();
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

type IntegrationRow = {
  id: string;
  provider: string | null;
  workspace_id: string | null;
  // tokens / config (ajusta nombres si difieren)
  access_token: string | null;
  config: Json | null;
};

function getConfigObject(config: Json | null): Record<string, Json> {
  if (config && typeof config === 'object' && !Array.isArray(config)) return config as Record<string, Json>;
  return {};
}

function extractFormIds(integration: IntegrationRow): string[] {
  const cfg = getConfigObject(integration.config);

  // ✅ Soporta varios shapes:
  // - config.form_id: "123"
  // - config.form_ids: ["123","456"]
  // - config.forms: [{id:"123"}, ...] (si te interesa, amplía aquí)
  const formId = safeString(cfg['form_id']);
  const formIds = safeStringArray(cfg['form_ids']);

  const merged = new Set<string>();
  if (formId) merged.add(formId);
  for (const id of formIds) merged.add(id);

  return Array.from(merged);
}

function extractMetaToken(integration: IntegrationRow): string | null {
  // Ajusta aquí si guardas token en config.page_access_token, etc.
  if (integration.access_token && integration.access_token.trim().length > 0) return integration.access_token.trim();

  const cfg = getConfigObject(integration.config);
  const t1 = safeString(cfg['access_token']);
  const t2 = safeString(cfg['page_access_token']);
  return t1 ?? t2 ?? null;
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

function getWorkspaceId(req: Request): string | null {
  // ✅ 1) Header
  const h = safeString(req.headers.get('x-workspace-id'));
  if (h) return h;

  // ✅ 2) Querystring
  const url = new URL(req.url);
  const q = safeString(url.searchParams.get('workspaceId'));
  if (q) return q;

  // ✅ 3) Body (si lo mandas)
  return null;
}

async function fetchMetaLeadsPage(args: {
  graphVersion: string;
  formId: string;
  token: string;
  after?: string;
  limit: number;
}): Promise<{ ok: true; page: MetaLeadsPage } | { ok: false; error: string }> {
  const { graphVersion, formId, token, after, limit } = args;

  // Campos típicos que Meta devuelve: id, created_time, field_data
  const fields = encodeURIComponent('id,created_time,field_data');

  const base = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(formId)}/leads`;
  const u = new URL(base);
  u.searchParams.set('access_token', token);
  u.searchParams.set('fields', fields);
  u.searchParams.set('limit', String(limit));
  if (after) u.searchParams.set('after', after);

  const res = await fetch(u.toString(), { method: 'GET', cache: 'no-store' });
  const text = await res.text();

  if (!res.ok) {
    // Meta suele devolver JSON con error.message
    return { ok: false, error: `Meta error (${res.status}): ${text}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: `Meta returned non-JSON: ${text}` };
  }

  // Validación ligera
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'Meta JSON inválido.' };
  return { ok: true, page: parsed as MetaLeadsPage };
}

/**
 * ✅ AJUSTA ESTO A TU ESQUEMA DE LEADS
 * Por defecto inserta en tabla "leads" con columnas:
 * - external_id (unique)
 * - source ("meta")
 * - created_at (timestamp)
 * - full_name, email, phone, profession, biggest_pain
 * - raw (jsonb) opcional
 */
type LeadInsert = {
  external_id: string;
  source: 'meta';
  created_at: string; // ISO
  full_name: string | null;
  email: string | null;
  phone: string | null;
  profession: string | null;
  biggest_pain: string | null;
  raw: Json | null;
};

function metaLeadToInsert(meta: MetaLead): LeadInsert {
  const fieldData = Array.isArray(meta.field_data) ? meta.field_data : [];

  // Nombres comunes de Meta Lead Ads
  const full = pickFirst(fieldData, ['full_name', 'name']) ?? null;
  const email = normalizeEmail(pickFirst(fieldData, ['email'])) ?? null;

  // Teléfono puede venir en varias keys
  const phone =
    normalizePhone(
      pickFirst(fieldData, ['phone_number', 'phone', 'mobile_phone', 'telephone'])
    ) ?? null;

  const profession = pickFirst(fieldData, ['profession', 'job_title']) ?? null;
  const pain = pickFirst(fieldData, ['biggest_pain', 'pain', 'message', 'custom_disclaimer']) ?? null;

  const created = safeString(meta.created_time) ?? new Date().toISOString();

  return {
    external_id: meta.id,
    source: 'meta',
    created_at: created,
    full_name: full,
    email,
    phone,
    profession,
    biggest_pain: pain,
    raw: {
      meta_lead: {
        id: meta.id,
        created_time: meta.created_time ?? null,
        field_data: meta.field_data ?? null,
      },
    },
  };
}

export async function POST(req: Request): Promise<NextResponse<ImportResult>> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const user = await getUserFromBearer(admin, req);
    if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

    // ✅ Necesitamos workspaceId para saber qué integración usar.
    // Si tu app no es multi-workspace, puedes quitar esto y usar directamente la única integración del usuario.
    let workspaceId = getWorkspaceId(req);

    // Si lo mandas por body, lo leemos aquí (sin forzar)
    if (!workspaceId) {
      const bodyText = await req.text();
      if (bodyText.trim().length > 0) {
        let bodyJson: unknown;
        try {
          bodyJson = JSON.parse(bodyText) as unknown;
        } catch {
          bodyJson = null;
        }
        if (bodyJson && typeof bodyJson === 'object' && !Array.isArray(bodyJson)) {
          const b = bodyJson as Record<string, unknown>;
          workspaceId = safeString(b['workspaceId']);
        }
      }
    }

    if (!workspaceId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Falta workspaceId. Envíalo por header x-workspace-id, query ?workspaceId=, o body {workspaceId}.',
        },
        { status: 400 }
      );
    }

    // ✅ Cambia aquí si tu tabla se llama distinto
    const INTEGRATIONS_TABLE = process.env.META_INTEGRATIONS_TABLE ?? 'integrations';

    // Traemos integraciones meta de ese workspace
    const { data: integrations, error: intErr } = await admin
      .from(INTEGRATIONS_TABLE)
      .select('id, provider, workspace_id, access_token, config')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'meta');

    if (intErr) return NextResponse.json({ ok: false, error: intErr.message }, { status: 500 });
    if (!integrations || integrations.length === 0) {
      return NextResponse.json({ ok: false, error: 'No hay integración Meta para este workspace.' }, { status: 404 });
    }

    // Parámetros import
    const graphVersion = process.env.META_GRAPH_VERSION ?? 'v20.0';
    const pageLimit = Number.parseInt(process.env.META_LEADS_PAGE_LIMIT ?? '100', 10);
    const maxPages = Number.parseInt(process.env.META_LEADS_MAX_PAGES ?? '5', 10);

    const LEADS_TABLE = process.env.LEADS_TABLE ?? 'leads';
    const LEADS_ON_CONFLICT = process.env.LEADS_ON_CONFLICT ?? 'external_id';

    let imported = 0;
    let skipped = 0;

    for (const row of integrations as IntegrationRow[]) {
      const token = extractMetaToken(row);
      const formIds = extractFormIds(row);

      if (!token) continue;
      if (formIds.length === 0) continue;

      for (const formId of formIds) {
        let after: string | undefined = undefined;

        for (let p = 0; p < maxPages; p += 1) {
          const pageRes = await fetchMetaLeadsPage({
            graphVersion,
            formId,
            token,
            after,
            limit: pageLimit,
          });

          if (!pageRes.ok) {
            // Si Meta responde con Invalid Scopes, te lo devolverá aquí.
            // No abortamos todo: seguimos con otras integraciones/forms.
            continue;
          }

          const leads = Array.isArray(pageRes.page.data) ? pageRes.page.data : [];
          if (leads.length === 0) break;

          const inserts: LeadInsert[] = leads.map(metaLeadToInsert);

          // Upsert por external_id (meta lead id) => evita duplicados aunque Meta y GHL estén activos.
          const { data: upserted, error: upErr } = await admin
            .from(LEADS_TABLE)
            .upsert(inserts, { onConflict: LEADS_ON_CONFLICT })
            .select('external_id');

          if (upErr) {
            // si tu tabla/columnas difieren, aquí lo verás
            break;
          }

          const upCount = Array.isArray(upserted) ? upserted.length : 0;
          imported += upCount;

          // Los “skipped” no los sabremos exacto con upsert sin lógica extra.
          // Aproximación: si Meta devolvió N y upsert devolvió M => skipped ~ N-M (puede variar según PostgREST).
          const approxSkipped = Math.max(0, inserts.length - upCount);
          skipped += approxSkipped;

          after = safeString(pageRes.page.paging?.cursors?.after) ?? undefined;
          if (!after) break;
        }
      }
    }

    return NextResponse.json({ ok: true, imported, skipped });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
