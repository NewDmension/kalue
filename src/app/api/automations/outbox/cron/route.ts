import { NextResponse } from 'next/server';

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

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function isVercelCron(req: Request): boolean {
  const h = req.headers;
  const x = (h.get('x-vercel-cron') ?? '').trim();
  if (x === '1' || x.toLowerCase() === 'true') return true;

  const ua = (h.get('user-agent') ?? '').toLowerCase();
  return ua.startsWith('vercel-cron/');
}

function pickSecretFromReq(req: Request): string | null {
  const u = new URL(req.url);

  const qs = (u.searchParams.get('secret') ?? '').trim();
  if (qs) return qs;

  const auth = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  return auth || null;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const expected = getEnv('KALUE_CRON_SECRET');

    if (!isVercelCron(req)) {
      const got = pickSecretFromReq(req);
      if (!got || !safeEq(got, expected)) {
        return json(401, { ok: false, error: 'unauthorized' });
      }
    }

    const base = new URL(req.url);
    const target = new URL('/api/automations/outbox/process-queue', base.origin);

    const res = await fetch(target.toString(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${expected}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const text = await res.text();
    let upstream: unknown = null;
    try {
      upstream = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      upstream = { raw: text };
    }

    return json(200, {
      ok: true,
      upstreamStatus: res.status,
      upstream,
      via: isVercelCron(req) ? 'vercel-cron' : 'manual-secret',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}