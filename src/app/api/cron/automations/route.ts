// src/app/api/cron/automations/route.ts
import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function GET(req: NextRequest) {
  // Protege el cron con un secret (Vercel Cron te permite mandar headers)
  const secret = process.env.CRON_SECRET ?? '';
  const got = req.headers.get('x-cron-secret') ?? '';

  if (!secret || got !== secret) {
    return json(401, { ok: false, error: 'unauthorized' });
  }

  // Llama a tu runner interno
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  if (!baseUrl) {
    return json(500, { ok: false, error: 'missing_NEXT_PUBLIC_APP_URL' });
  }

  const runnerSecret = process.env.AUTOMATIONS_RUNNER_SECRET ?? '';
  if (!runnerSecret) {
    return json(500, { ok: false, error: 'missing_AUTOMATIONS_RUNNER_SECRET' });
  }

  const url = new URL('/api/automations/runner', baseUrl);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-secret': runnerSecret,
    },
    // opcional: puedes pasar límites si tu runner los acepta
    body: JSON.stringify({ limitEvents: 25, limitSteps: 50 }),
  }).catch(() => null);

  if (!res) return json(502, { ok: false, error: 'runner_unreachable' });

  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) return json(res.status, { ok: false, error: 'runner_failed', detail: data });

  return json(200, { ok: true, runner: data });
}