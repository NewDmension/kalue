import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

type WorkflowLite = {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  created_at?: string | null;
  updated_at?: string | null;
};

type PipelineWorkflowRow = {
  workflow_id: string;
};

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!isUuid(workspaceId)) return json(400, { ok: false, error: 'invalid_workspace' });

    const url = new URL(req.url);
    const pipelineId = (url.searchParams.get('pipelineId') ?? '').trim();
    if (!isUuid(pipelineId)) return json(400, { ok: false, error: 'invalid_pipeline_id' });

    const supabase = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) Verificar que el pipeline pertenece al workspace
    const pRes = await supabase.from('pipelines').select('id,workspace_id').eq('id', pipelineId).maybeSingle();
    if (pRes.error) return json(500, { ok: false, error: 'db_error', detail: pRes.error.message });

    const pWs = (pRes.data as { workspace_id?: unknown } | null)?.workspace_id;
    if (typeof pWs !== 'string' || pWs !== workspaceId) {
      return json(403, { ok: false, error: 'pipeline_not_in_workspace' });
    }

    // 2) Traer workflows activos del workspace
    const wRes = await supabase
      .from('workflows')
      .select('id,workspace_id,name,status,created_at,updated_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (wRes.error) return json(500, { ok: false, error: 'db_error', detail: wRes.error.message });

    const workflows = (wRes.data ?? []) as unknown as WorkflowLite[];

    // 3) Traer los workflow_ids que están activados para este pipeline
    const linkRes = await supabase
      .from('pipeline_workflows')
      .select('workflow_id')
      .eq('workspace_id', workspaceId)
      .eq('pipeline_id', pipelineId);

    if (linkRes.error) return json(500, { ok: false, error: 'db_error', detail: linkRes.error.message });

    const links = (linkRes.data ?? []) as unknown as PipelineWorkflowRow[];
    const activeSet = new Set<string>(links.map((x) => x.workflow_id));

    // 4) Devolver en un formato simple para UI
    const items = workflows.map((w) => ({
      id: w.id,
      name: w.name,
      status: w.status,
      isActive: activeSet.has(w.id),
    }));

    return json(200, { ok: true, pipelineId, workflows: items });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
