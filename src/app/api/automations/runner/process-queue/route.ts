// src/app/api/automations/runner/process-queue/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { POST as tickPOST } from '../tick/route';

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

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function pickBearer(req: Request): string | null {
  const raw = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  return raw || null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // ✅ Mantiene tu seguridad actual (cron → process-queue con Bearer secret)
    const expected = getEnv('KALUE_CRON_SECRET');
    const got = pickBearer(req);

    if (!got || !safeEq(got, expected)) {
      return json(401, { ok: false, error: 'unauthorized' });
    }

    // ✅ Delegamos al nuevo motor (runner/tick) sin cambiar cron/vercel.json
    // Nota: tickPOST puede no validar secret; aquí ya queda validado.
    return await tickPOST(req);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}