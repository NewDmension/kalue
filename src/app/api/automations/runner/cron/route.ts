// src/app/api/automations/runner/cron/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
  return m ? m[1].trim() : null;
}

async function safeReadJson(res: Response): Promise<Record<string, unknown> | null> {
  const txt = await res.text();
  if (!txt) return null;
  try {
    const parsed = JSON.parse(txt) as unknown;
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
    return { raw: txt };
  } catch {
    return { raw: txt };
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const secret = getEnv('KALUE_CRON_SECRET');

    const url = new URL(req.url);

    // ✅ Vercel cron NO manda Authorization; normalmente lo pasas por query param
    // (path puede incluir ?secret=...)
    const gotFromQuery = (url.searchParams.get('secret') ?? '').trim();
    const gotFromBearer = getBearer(req);

    const got = gotFromBearer || gotFromQuery;

    if (!got || got !== secret) {
      return json(401, { ok: false, error: 'unauthorized' });
    }

    // Llamada interna a process-queue
    const origin = url.origin;
    const target = new URL('/api/automations/runner/process-queue', origin);

    const r = await fetch(target.toString(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      // body vacío; process-queue no lo necesita
      body: JSON.stringify({}),
      cache: 'no-store',
    });

    // ✅ Propaga status/body de process-queue tal cual (importantísimo para debug)
    const data = await safeReadJson(r);
    return json(r.status, {
      ok: r.ok,
      upstreamStatus: r.status,
      upstream: data,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
