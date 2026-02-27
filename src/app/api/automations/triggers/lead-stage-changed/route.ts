// src/app/api/automations/triggers/lead-stage-changed/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/supabase/serviceRole';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Body = {
  workspaceId: string;
  leadId: string;
  pipelineId: string;
  fromStageId?: string;
  toStageId: string;
};

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function POST(req: NextRequest) {
  const sb = supabaseServiceRole();

  const xWorkspaceId = req.headers.get('x-workspace-id');

  let bodyUnknown: unknown = null;
  try {
    bodyUnknown = (await req.json()) as unknown;
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }
  if (!isRecord(bodyUnknown)) return json(400, { ok: false, error: 'invalid_body' });

  const workspaceId = pickStr(bodyUnknown, 'workspaceId');
  const leadId = pickStr(bodyUnknown, 'leadId');
  const pipelineId = pickStr(bodyUnknown, 'pipelineId');
  const toStageId = pickStr(bodyUnknown, 'toStageId');
  const fromStageId = pickStr(bodyUnknown, 'fromStageId') ?? undefined;

  if (!workspaceId || !leadId || !pipelineId || !toStageId) {
    return json(400, { ok: false, error: 'missing_fields' });
  }

  // coherencia: header debe coincidir con body (anti “spoof”)
  if (!xWorkspaceId || xWorkspaceId !== workspaceId) {
    return json(400, { ok: false, error: 'workspace_mismatch' });
  }

  const payload = {
    workspaceId,
    leadId,
    pipelineId,
    fromStageId: fromStageId ?? null,
    toStageId,
    occurredAt: new Date().toISOString(),
  };

  const { error } = await sb.from('workflow_event_queue').insert({
    workspace_id: workspaceId,
    event_type: 'lead.stage_changed',
    entity_id: leadId,
    payload,
  });

  if (error) {
    return json(500, { ok: false, error: 'enqueue_failed', detail: error.message });
  }

  return json(200, { ok: true });
}