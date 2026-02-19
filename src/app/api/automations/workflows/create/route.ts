import { NextResponse } from 'next/server';
import { requireAuthedWorkspace } from '@/lib/api/authWorkspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function POST(req: Request): Promise<NextResponse> {
  const ctx = await requireAuthedWorkspace(req);
  if (ctx instanceof Response) return NextResponse.json(await ctx.json(), { status: ctx.status });

  const body = await safeJson(req);
  const nameRaw = isRecord(body) && typeof body.name === 'string' ? body.name.trim() : '';
  const name = nameRaw || 'Nuevo workflow';

  const { admin, workspaceId } = ctx;

  const { data, error } = await admin
    .from('workflows')
    .insert({ workspace_id: workspaceId, name, status: 'draft' })
    .select('id,workspace_id,name,status,created_at,updated_at')
    .single();

  if (error || !data) {
    const msg = error?.message ?? 'insert_failed';
    return NextResponse.json({ ok: false, error: 'db_error', detail: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true, workflow: data, workflowId: data.id }, { status: 200 });
}
