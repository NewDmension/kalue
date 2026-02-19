// src/app/api/pipelines/board/route.ts
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

function getBearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

async function getAuthedUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

async function isWorkspaceMember(args: { admin: SupabaseClient; workspaceId: string; userId: string }): Promise<boolean> {
  const { data, error } = await args.admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', args.workspaceId)
    .eq('user_id', args.userId)
    .limit(1);

  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

type StageRow = {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  color: string | null;
  is_won: boolean;
  is_lost: boolean;
  is_default: boolean;
};

type LeadRow = {
  id: string;
  workspace_id: string;
  created_at: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  source: string | null;
  labels: string[] | null;
  notes: string | null;
};

type StateRow = {
  lead_id: string;
  workspace_id: string;
  pipeline_id: string;
  stage_id: string;
  position: number;
  stage_changed_at: string;
  created_at: string;
  updated_at: string;
};

type BoardLead = LeadRow & {
  stage_id: string;
  position: number;
  stage_changed_at: string | null;
};

function safeTime(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearer(req);
    if (!token) return json(401, { error: 'login_required' });

    const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
    if (!workspaceId) return json(400, { error: 'missing_workspace_id' });

    const url = new URL(req.url);
    const pipelineId = (url.searchParams.get('pipelineId') ?? '').trim();
    if (!pipelineId) return json(400, { error: 'missing_pipelineId' });

    // Auth user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const userId = await getAuthedUserId(userClient);
    if (!userId) return json(401, { error: 'login_required' });

    // Admin
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ok = await isWorkspaceMember({ admin, workspaceId, userId });
    if (!ok) return json(403, { error: 'not_member' });

    // pipeline pertenece al workspace
    const { data: p, error: pErr } = await admin
      .from('pipelines')
      .select('id')
      .eq('id', pipelineId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (pErr) return json(500, { error: 'db_error', detail: pErr.message });
    if (!p) return json(404, { error: 'pipeline_not_found' });

    // stages (✅ incluye is_default)
    const { data: stagesRaw, error: sErr } = await admin
      .from('pipeline_stages')
      .select('id, pipeline_id, name, sort_order, color, is_won, is_lost, is_default')
      .eq('pipeline_id', pipelineId)
      .order('sort_order', { ascending: true });

    if (sErr) return json(500, { error: 'db_error', detail: sErr.message });

    const stages = (Array.isArray(stagesRaw) ? stagesRaw : []) as unknown as StageRow[];
    if (stages.length === 0) return json(200, { ok: true, stages: [], leadsByStage: {} });

    // ✅ default fijo por pipeline (NO depende del orden visual)
    const defaultStageId = stages.find((s) => s.is_default)?.id ?? stages[0]?.id ?? null;
    if (!defaultStageId) return json(200, { ok: true, stages, leadsByStage: {} });

    // estado actual (ordenado desde DB para consistencia)
    const { data: stateRaw, error: stErr } = await admin
      .from('lead_pipeline_state')
      .select('lead_id, workspace_id, pipeline_id, stage_id, position, stage_changed_at, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('pipeline_id', pipelineId)
      .order('stage_id', { ascending: true })
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (stErr) return json(500, { error: 'db_error', detail: stErr.message });

    const stateRows = (Array.isArray(stateRaw) ? stateRaw : []) as unknown as StateRow[];
    const stateByLeadId = new Map<string, StateRow>();
    for (const r of stateRows) stateByLeadId.set(r.lead_id, r);

    // TODOS los leads del workspace
    const { data: leadsRaw, error: lErr } = await admin
      .from('leads')
      .select('id, workspace_id, created_at, full_name, email, phone, status, source, labels, notes')
      .eq('workspace_id', workspaceId)
      .limit(500);

    if (lErr) return json(500, { error: 'db_error', detail: lErr.message });

    const leads = (Array.isArray(leadsRaw) ? leadsRaw : []) as unknown as LeadRow[];

    // Construir leads con stage/position
    const byStage: Record<string, BoardLead[]> = {};
    for (const st of stages) byStage[st.id] = [];

    for (const lead of leads) {
      const st = stateByLeadId.get(lead.id);
      const stageId = st?.stage_id ?? defaultStageId;
      const position = typeof st?.position === 'number' ? st.position : 0;
      const stageChangedAt = st?.stage_changed_at ?? null;

      const enriched: BoardLead = {
        ...lead,
        stage_id: stageId,
        position,
        stage_changed_at: stageChangedAt,
      };

      if (!byStage[stageId]) byStage[stageId] = [];
      byStage[stageId].push(enriched);
    }

    // Orden interno por position, fallback por created_at (estable)
    for (const stageId of Object.keys(byStage)) {
      byStage[stageId].sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        const ta = safeTime(a.created_at);
        const tb = safeTime(b.created_at);
        if (ta !== tb) return ta - tb; // más antiguo primero
        return a.id.localeCompare(b.id);
      });
    }

    return json(200, { ok: true, stages, leadsByStage: byStage });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'server_error';
    return json(500, { error: 'server_error', detail: msg });
  }
}
