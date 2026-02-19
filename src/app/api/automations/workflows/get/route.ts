import { NextResponse } from 'next/server';
import { requireAuthedWorkspace } from '@/lib/api/authWorkspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type WorkflowRow = {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type NodeRow = {
  id: string;
  workflow_id: string;
  type: string;
  name: string;
  config: unknown;
  ui: unknown;
  created_at: string;
  updated_at: string;
};

type EdgeRow = {
  id: string;
  workflow_id: string;
  from_node_id: string;
  to_node_id: string;
  condition_key: string | null;
  created_at: string;
};

export async function GET(req: Request): Promise<NextResponse> {
  const ctx = await requireAuthedWorkspace(req);
  if (ctx instanceof Response) return NextResponse.json(await ctx.json(), { status: ctx.status });

  const url = new URL(req.url);
  const id = (url.searchParams.get('id') ?? '').trim();
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });

  const { admin, workspaceId } = ctx;

  const { data: wf, error: wfErr } = await admin
    .from('workflows')
    .select('id,workspace_id,name,status,created_at,updated_at')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (wfErr) return NextResponse.json({ ok: false, error: 'db_error', detail: wfErr.message }, { status: 500 });
  if (!wf) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  const [nodesRes, edgesRes] = await Promise.all([
    admin.from('workflow_nodes').select('*').eq('workflow_id', id).order('created_at', { ascending: true }),
    admin.from('workflow_edges').select('*').eq('workflow_id', id).order('created_at', { ascending: true }),
  ]);

  if (nodesRes.error) {
    return NextResponse.json({ ok: false, error: 'db_error', detail: nodesRes.error.message }, { status: 500 });
  }
  if (edgesRes.error) {
    return NextResponse.json({ ok: false, error: 'db_error', detail: edgesRes.error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      workflow: wf as WorkflowRow,
      nodes: (nodesRes.data ?? []) as NodeRow[],
      edges: (edgesRes.data ?? []) as EdgeRow[],
    },
    { status: 200 }
  );
}
