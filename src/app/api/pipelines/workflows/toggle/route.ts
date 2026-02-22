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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickString(v: unknown, key: string): string {
  if (!isRecord(v)) return '';
  const x = v[key];
  return typeof x === 'string' ? x.trim() : '';
}

function pickBool(v: unknown, key: string): boolean | null {
  if (!isRecord(v)) return null;
  const x = v[key];
  if (typeof x === 'boolean') return x;
  return null;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!isUuid(workspaceId)) return json(400, { ok: false, error: 'invalid_workspace' });

    const bodyUnknown = (await req.json()) as unknown;

    const pipelineId = pickString(bodyUnknown, 'pipelineId');
    const workflowId = pickString(bodyUnknown, 'workflowId');
    const isActive = pickBool(bodyUnknown, 'isActive');

    if (!isUuid(pipelineId)) return json(400, { ok: false, error: 'invalid_pipeline_id' });
    if (!isUuid(workflowId)) return json(400, { ok: false, error: 'invalid_workflow_id' });
    if (isActive === null) return json(400, { ok: false, error: 'invalid_isActive' });

    const supabase = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Seguridad básica: pipeline y workflow deben pertenecer a este workspace
    const [pRes, wRes] = await Promise.all([
      supabase.from('pipelines').select('id,workspace_id').eq('id', pipelineId).maybeSingle(),
      supabase.from('workflows').select('id,workspace_id').eq('id', workflowId).maybeSingle(),
    ]);

    if (pRes.error) return json(500, { ok: false, error: 'db_error', detail: pRes.error.message });
    if (wRes.error) return json(500, { ok: false, error: 'db_error', detail: wRes.error.message });

    const pWs = (pRes.data as { workspace_id?: unknown } | null)?.workspace_id;
    const wWs = (wRes.data as { workspace_id?: unknown } | null)?.workspace_id;

    if (typeof pWs !== 'string' || pWs !== workspaceId) return json(403, { ok: false, error: 'pipeline_not_in_workspace' });
    if (typeof wWs !== 'string' || wWs !== workspaceId) return json(403, { ok: false, error: 'workflow_not_in_workspace' });

    if (isActive) {
      const ins = await supabase
        .from('pipeline_workflows')
        .insert({ workspace_id: workspaceId, pipeline_id: pipelineId, workflow_id: workflowId });

      // Si ya existe (unique), lo consideramos OK
      if (ins.error && ins.error.code !== '23505') {
        return json(500, { ok: false, error: 'db_error', detail: ins.error.message });
      }

      return json(200, { ok: true, isActive: true });
    }

    const del = await supabase
      .from('pipeline_workflows')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('pipeline_id', pipelineId)
      .eq('workflow_id', workflowId);

    if (del.error) return json(500, { ok: false, error: 'db_error', detail: del.error.message });

    return json(200, { ok: true, isActive: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { ok: false, error: 'server_error', detail: msg });
  }
}
