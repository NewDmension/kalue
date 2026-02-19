import { NextResponse } from 'next/server';
import { requireAuthedWorkspace, jsonError } from '@/lib/api/authWorkspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WorkflowRow = {
  id: string;
  workspace_id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | string;
  created_at: string;
  updated_at: string;
};

export async function GET(req: Request): Promise<NextResponse> {
  const ctx = await requireAuthedWorkspace(req);
  if (ctx instanceof Response) return NextResponse.json(await ctx.json(), { status: ctx.status });

  const { admin, workspaceId } = ctx;

  const { data, error } = await admin
    .from('workflows')
    .select('id,workspace_id,name,status,created_at,updated_at')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: 'db_error', detail: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, workflows: (data ?? []) as WorkflowRow[] }, { status: 200 });
}
