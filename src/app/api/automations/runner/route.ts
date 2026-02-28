import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/supabase/serviceRole';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type QueueRow = {
  id: string;
  workspace_id: string;
  event_type: string;
  entity_id: string;
  payload: unknown;
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

/**
 * Lee N eventos pendientes, los bloquea con lock_token,
 * y devuelve filas para procesar. Es idempotente.
 */
async function lockNextEvents(args: { limit: number; lockToken: string }): Promise<QueueRow[]> {
  const sb = supabaseServiceRole();

  // 1) seleccionar candidatos
  const { data: ids, error: e1 } = await sb
    .from('workflow_event_queue')
    .select('id')
    .is('processed_at', null)
    .is('locked_at', null)
    .order('created_at', { ascending: true })
    .limit(args.limit);

  if (e1 || !Array.isArray(ids) || ids.length === 0) return [];

  const idList = ids
    .map((r) => (isRecord(r) ? pickStr(r, 'id') : null))
    .filter((x): x is string => Boolean(x));

  if (idList.length === 0) return [];

  // 2) lock
  const nowIso = new Date().toISOString();
  const { error: e2 } = await sb
    .from('workflow_event_queue')
    .update({ locked_at: nowIso, lock_token: args.lockToken })
    .in('id', idList)
    .is('processed_at', null)
    .is('locked_at', null);

  if (e2) return [];

  // 3) leer locked
  const { data: rows, error: e3 } = await sb
    .from('workflow_event_queue')
    .select('id, workspace_id, event_type, entity_id, payload')
    .eq('lock_token', args.lockToken)
    .is('processed_at', null);

  if (e3 || !Array.isArray(rows)) return [];

  const out: QueueRow[] = [];
  for (const r of rows) {
    if (!isRecord(r)) continue;
    const id = pickStr(r, 'id');
    const workspaceId = pickStr(r, 'workspace_id');
    const eventType = pickStr(r, 'event_type');
    const entityId = pickStr(r, 'entity_id');
    const payload = (r as { payload?: unknown }).payload;

    if (!id || !workspaceId || !eventType || !entityId) continue;
    out.push({ id, workspace_id: workspaceId, event_type: eventType, entity_id: entityId, payload });
  }
  return out;
}

async function markProcessed(args: { ids: string[]; lockToken: string }): Promise<void> {
  if (args.ids.length === 0) return;
  const sb = supabaseServiceRole();
  const nowIso = new Date().toISOString();
  await sb
    .from('workflow_event_queue')
    .update({ processed_at: nowIso })
    .in('id', args.ids)
    .eq('lock_token', args.lockToken)
    .is('processed_at', null);
}

async function releaseLock(args: { ids: string[]; lockToken: string }): Promise<void> {
  if (args.ids.length === 0) return;
  const sb = supabaseServiceRole();
  await sb
    .from('workflow_event_queue')
    .update({ locked_at: null, lock_token: null })
    .in('id', args.ids)
    .eq('lock_token', args.lockToken)
    .is('processed_at', null);
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const expected = process.env.AUTOMATIONS_RUNNER_SECRET ?? '';
  if (!expected || auth !== `Bearer ${expected}`) {
    return json(401, { ok: false, error: 'unauthorized' });
  }

  const lockToken = crypto.randomUUID();
  const batch = await lockNextEvents({ limit: 25, lockToken });

  if (batch.length === 0) return json(200, { ok: true, processed: 0 });

  const processedIds: string[] = [];
  const toRelease: string[] = [];

  for (const ev of batch) {
    // Solo manejamos por ahora lead.stage_changed
    if (ev.event_type !== 'lead.stage_changed') {
      processedIds.push(ev.id);
      continue;
    }

    // payload esperado:
    // { leadId, pipelineId, fromStageId?, toStageId }
    const p = isRecord(ev.payload) ? ev.payload : {};
    const leadId = pickStr(p, 'leadId') ?? ev.entity_id;
    const pipelineId = pickStr(p, 'pipelineId');
    const toStageId = pickStr(p, 'toStageId');
    const fromStageId = pickStr(p, 'fromStageId') ?? undefined;

    if (!pipelineId || !toStageId) {
      // payload inválido -> marcamos procesado para no bloquear
      processedIds.push(ev.id);
      continue;
    }

    try {
      const url = new URL('/api/automations/triggers/lead-stage-changed', req.nextUrl.origin);

      const r = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // aquí NO necesitamos auth del user, porque el trigger endpoint usa service_role
        },
        body: JSON.stringify({
          workspaceId: ev.workspace_id,
          leadId,
          pipelineId,
          fromStageId,
          toStageId,
        }),
      });

      if (!r.ok) {
        // fallo -> soltamos lock para reintentar en próximo run
        toRelease.push(ev.id);
        continue;
      }

      processedIds.push(ev.id);
    } catch {
      toRelease.push(ev.id);
    }
  }

  await markProcessed({ ids: processedIds, lockToken });
  await releaseLock({ ids: toRelease, lockToken });

  return json(200, { ok: true, processed: processedIds.length, released: toRelease.length });
}