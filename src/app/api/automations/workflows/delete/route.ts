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
  const id = isRecord(body) && typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });

  const { admin, workspaceId } = ctx;

  const { error } = await admin.from('workflows').delete().eq('id', id).eq('workspace_id', workspaceId);
  if (error) return NextResponse.json({ ok: false, error: 'db_error', detail: error.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
