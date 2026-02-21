import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickString(obj: unknown, key: string): string | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const secret = getEnv('KALUE_CRON_SECRET');
    const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

    if (!got || got !== secret) {
      return json(401, { ok: false, error: 'unauthorized' });
    }

    const body = await req.json();
    const workspaceId = pickString(body, 'workspaceId');
    const pipelineId = pickString(body, 'pipelineId');

    if (!workspaceId || !pipelineId) {
      return json(400, { ok: false, error: 'missing_params' });
    }

    const supabase = createClient(
      getEnv('NEXT_PUBLIC_SUPABASE_URL'),
      getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data, error } = await supabase
      .from('pipeline_workflows')
      .select('workflow_id, is_active')
      .eq('workspace_id', workspaceId)
      .eq('pipeline_id', pipelineId);

    if (error) {
      return json(500, { ok: false, error: error.message });
    }

    return json(200, { ok: true, data: data ?? [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: msg });
  }
}
