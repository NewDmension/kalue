// src/app/api/automations/runner/cron/route.ts
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

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const secret = getEnv('KALUE_CRON_SECRET');

    const url = new URL(req.url);
    const got = (url.searchParams.get('secret') ?? '').trim();

    if (!got || got !== secret) return json(401, { ok: false, error: 'unauthorized' });

    // Llama a process-queue con el header correcto
    const origin = url.origin;

    const res = await fetch(`${origin}/api/automations/runner/process-queue`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
      },
      cache: 'no-store',
    });

    let out: unknown = null;
    try {
      out = (await res.json()) as unknown;
    } catch {
      out = null;
    }

    if (!res.ok) {
      return json(500, {
        ok: false,
        error: 'process_queue_failed',
        status: res.status,
        detail: out,
      });
    }

    return json(200, {
      ok: true,
      forwarded: true,
      result: out,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
