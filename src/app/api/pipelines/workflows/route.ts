import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function isUuid(v: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(v);
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const pipelineId = url.searchParams.get('pipelineId') ?? '';
  const workspaceId = req.headers.get('x-workspace-id') ?? '';

  if (!isUuid(pipelineId)) {
    return NextResponse.json({ ok: false, error: 'invalid_pipeline_id' }, { status: 400 });
  }

  if (!isUuid(workspaceId)) {
    return NextResponse.json({ ok: false, error: 'invalid_workspace' }, { status: 400 });
  }

  const supabase = createClient(
    getEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getEnv('SUPABASE_SERVICE_ROLE_KEY')
  );

  // 1️⃣ Workflows del workspace
  const { data: workflows, error: wfError } = await supabase
    .from('workflows')
    .select('id, name, status')
    .eq('workspace_id', workspaceId);

  if (wfError) {
    return NextResponse.json({ ok: false, error: wfError.message }, { status: 500 });
  }

  // 2️⃣ Mappings pipeline ↔ workflow
  const { data: mappings, error: mapError } = await supabase
    .from('pipeline_workflows')
    .select('workflow_id')
    .eq('pipeline_id', pipelineId);

  if (mapError) {
    return NextResponse.json({ ok: false, error: mapError.message }, { status: 500 });
  }

  const attachedIds = new Set((mappings ?? []).map((m) => m.workflow_id));

  const result = (workflows ?? []).map((wf) => ({
    id: wf.id,
    name: wf.name,
    status: wf.status,
    isAttached: attachedIds.has(wf.id),
  }));

  return NextResponse.json({
    ok: true,
    workflows: result,
  });
}
