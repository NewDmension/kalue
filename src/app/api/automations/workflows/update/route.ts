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

function pickString(v: unknown, key: string): string {
  if (!isRecord(v)) return '';
  const x = v[key];
  return typeof x === 'string' ? x.trim() : '';
}

export async function POST(req: Request): Promise<NextResponse> {
  const ctx = await requireAuthedWorkspace(req);
  if (ctx instanceof Response) return NextResponse.json(await ctx.json(), { status: ctx.status });

  const body = await safeJson(req);
  const id = pickString(body, 'id');
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });

  const name = pickString(body, 'name');
  const status = pickString(body, 'status');

  const patch: Record<string, unknown> = {};
  if (name) patch.name = name;
  if (status) patch.status = status;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing_to_update' }, { status: 400 });
  }

  const { admin, workspaceId } = ctx;

  const { data, error } = await admin
    .from('workflows')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id,workspace_id,name,status,created_at,updated_at')
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: 'db_error', detail: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  return NextResponse.json({ ok: true, workflow: data }, { status: 200 });
}
