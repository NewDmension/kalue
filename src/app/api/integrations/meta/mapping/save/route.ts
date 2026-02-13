// src/app/api/integrations/meta/mapping/save/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
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

function getBaseUrl(req: Request): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  if (!host) throw new Error('Missing host header');
  return `${proto}://${host}`;
}

async function safeJsonFromResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { _nonJson: true, text };
  }
}

/**
 * WRAPPER:
 * - Mantiene viva la ruta antigua /mapping/save
 * - Redirige a /mappings/upsert (plural)
 * - No rompe UI si aún hay fetch viejo apuntando aquí
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const token = getBearer(req);
    if (!token) return json(401, { error: 'login_required' });

    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!workspaceId) return json(400, { error: 'missing_workspace_id' });

    const body = await safeJson(req);

    const integrationId = pickString(body, 'integrationId');
    const pageId = pickString(body, 'pageId');
    const pageNameRaw = pickString(body, 'pageName');
    const pageName = pageNameRaw ? pageNameRaw : null;

    const formIdRaw = pickString(body, 'formId');
    const formId = formIdRaw ? formIdRaw : '';
    const formNameRaw = pickString(body, 'formName');
    const formName = formNameRaw ? formNameRaw : null;

    if (!integrationId) return json(400, { error: 'missing_integrationId' });
    if (!pageId) return json(400, { error: 'missing_pageId' });
    if (!formId) return json(400, { error: 'missing_formId' });

    // Adaptamos a payload del endpoint plural
    const forwardBody: Record<string, unknown> = {
      integrationId,
      pageId,
      pageName,
      forms: [{ formId, formName }],
    };

    const baseUrl = getBaseUrl(req);
    const forwardUrl = `${baseUrl}/api/integrations/meta/mappings/upsert`;

    const forwardRes = await fetch(forwardUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': workspaceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify(forwardBody),
      cache: 'no-store',
    });

    const raw = await safeJsonFromResponse(forwardRes);

    if (!forwardRes.ok) {
      const message =
        isRecord(raw) && typeof raw.error === 'string' ? raw.error : 'forward_failed';
      return json(forwardRes.status, {
        error: message,
        where: 'mapping/save -> mappings/upsert',
        raw,
      });
    }

    // Compat: devolvemos "mapping" como antes (si el plural devuelve mappings[])
    // Si no hay array, devolvemos raw tal cual.
    if (isRecord(raw) && Array.isArray(raw.mappings) && raw.mappings.length > 0) {
      return json(200, { ok: true, mapping: raw.mappings[0], _compat: true });
    }

    return json(200, { ok: true, _compat: true, raw });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { error: 'server_error', detail: msg });
  }
}
