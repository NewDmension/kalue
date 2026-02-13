// src/app/api/integrations/meta/webhook/subscribe/route.ts
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
 * - Mantiene viva la ruta antigua /webhook/subscribe
 * - Redirige a /webhooks/subscribe (plural)
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const token = getBearer(req);
    if (!token) return json(401, { error: 'login_required' });

    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!workspaceId) return json(400, { error: 'missing_workspace_id' });

    const bodyText = await req.text();
    const baseUrl = getBaseUrl(req);
    const forwardUrl = `${baseUrl}/api/integrations/meta/webhooks/subscribe`;

    const forwardRes = await fetch(forwardUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-workspace-id': workspaceId,
        'content-type': 'application/json',
      },
      body: bodyText || '{}',
      cache: 'no-store',
    });

    const raw = await safeJsonFromResponse(forwardRes);

    if (!forwardRes.ok) {
      return json(forwardRes.status, {
        error: 'forward_failed',
        where: 'webhook/subscribe -> webhooks/subscribe',
        raw,
      });
    }

    return json(200, isRecord(raw) ? (raw as Record<string, unknown>) : { ok: true, raw });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { error: 'server_error', detail: msg });
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
