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

function isVercelCron(req: Request): boolean {
  const ua = (req.headers.get('user-agent') ?? '').toLowerCase();
  // En tus logs aparece: vercel-cron/1.0
  if (ua.includes('vercel-cron/')) return true;
  return false;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    if (!isVercelCron(req)) {
      return json(401, { ok: false, error: 'unauthorized_cron' });
    }

    const secret = getEnv('KALUE_CRON_SECRET');

    // Llamamos al runner real (POST) con header Authorization.
    const baseUrl = new URL(req.url).origin;

    const res = await fetch(`${baseUrl}/api/automations/runner/process-queue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ source: 'vercel_cron' }),
      cache: 'no-store',
    });

    let raw: unknown = null;
    try {
      raw = (await res.json()) as unknown;
    } catch {
      raw = null;
    }

    if (!res.ok) {
      return json(500, {
        ok: false,
        error: 'runner_failed',
        status: res.status,
        response: raw,
      });
    }

    return json(200, { ok: true, runner: raw });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
