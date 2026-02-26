// src/app/api/automations/runner/tick/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/supabase/serviceRole';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function json(status: number, payload: Record<string, unknown>) {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

type ActionConfig =
  | { action: 'lead.add_label'; label: string }
  | { action: 'action.send_email'; to: string; subject: string; body: string }
  | { action: 'action.send_sms'; to: string; body: string };

function asActionConfig(v: unknown): ActionConfig | null {
  if (!isRecord(v)) return null;
  const a = v.action;

  if (a === 'lead.add_label') {
    return { action: 'lead.add_label', label: typeof v.label === 'string' ? v.label : '' };
  }

  if (a === 'action.send_email') {
    return {
      action: 'action.send_email',
      to: typeof v.to === 'string' ? v.to : '',
      subject: typeof v.subject === 'string' ? v.subject : '',
      body: typeof v.body === 'string' ? v.body : '',
    };
  }

  if (a === 'action.send_sms') {
    return { action: 'action.send_sms', to: typeof v.to === 'string' ? v.to : '', body: typeof v.body === 'string' ? v.body : '' };
  }

  return null;
}

export async function POST(_req: NextRequest) {
  const sb = supabaseServiceRole();

  // 1) claim steps
  const { data: claimed, error: cErr } = await sb.rpc('workflow_claim_run_steps', {
    p_batch_size: 25,
    p_locker: `runner-${process.env.VERCEL_REGION ?? 'local'}`,
  });

  if (cErr) return json(500, { ok: false, error: 'claim_failed', detail: cErr.message });

  const steps = Array.isArray(claimed) ? claimed : [];
  if (steps.length === 0) return json(200, { ok: true, processed: 0 });

  const nodeIds = steps.map((s) => s.node_id as string).filter((x) => typeof x === 'string');
  const runIds = steps.map((s) => s.run_id as string).filter((x) => typeof x === 'string');

  // 2) cargar nodos
  const { data: nodeRows, error: nErr } = await sb.from('workflow_nodes').select('id, workflow_id, type, config').in('id', nodeIds);
  if (nErr) return json(500, { ok: false, error: 'nodes_fetch_failed', detail: nErr.message });

  const nodeById = new Map<string, { id: string; workflow_id: string; type: string; config: unknown }>();
  for (const r of nodeRows ?? []) {
    if (r && typeof r.id === 'string') {
      nodeById.set(r.id, r as { id: string; workflow_id: string; type: string; config: unknown });
    }
  }

  // 3) cargar runs
  const { data: runRows, error: rErr } = await sb.from('workflow_runs').select('id, workflow_id, workspace_id, context').in('id', runIds);
  if (rErr) return json(500, { ok: false, error: 'runs_fetch_failed', detail: rErr.message });

  const runById = new Map<string, { id: string; workflow_id: string; workspace_id: string; context: unknown }>();
  for (const r of runRows ?? []) {
    if (r && typeof r.id === 'string') {
      runById.set(r.id, r as { id: string; workflow_id: string; workspace_id: string; context: unknown });
    }
  }

  // 4) edges por workflow
  const workflowIds = Array.from(
    new Set((runRows ?? []).map((r) => r.workflow_id).filter((x): x is string => typeof x === 'string'))
  );

  const { data: edgeRows, error: eErr } = await sb
    .from('workflow_edges')
    .select('workflow_id, from_node_id, to_node_id')
    .in('workflow_id', workflowIds);

  if (eErr) return json(500, { ok: false, error: 'edges_fetch_failed', detail: eErr.message });

  const nextMap = new Map<string, string[]>();
  for (const e of edgeRows ?? []) {
    const from = (e as { from_node_id: unknown }).from_node_id;
    const to = (e as { to_node_id: unknown }).to_node_id;
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    const arr = nextMap.get(from) ?? [];
    arr.push(to);
    nextMap.set(from, arr);
  }

  let processed = 0;

  for (const s of steps) {
    const stepId = s.id as string;
    const runId = s.run_id as string;
    const nodeId = s.node_id as string;

    const run = runById.get(runId);
    const node = nodeById.get(nodeId);

    if (!run || !node) {
      await sb
        .from('workflow_run_steps')
        .update({ status: 'failed', error: 'missing_run_or_node', finished_at: new Date().toISOString() })
        .eq('id', stepId);
      continue;
    }

    try {
      if (node.type !== 'action') {
        await sb
          .from('workflow_run_steps')
          .update({ status: 'skipped', output: { reason: 'non_action_node' }, finished_at: new Date().toISOString() })
          .eq('id', stepId);
        processed += 1;
        continue;
      }

      const cfg = asActionConfig(node.config);
      if (!cfg) {
        await sb.from('workflow_run_steps').update({ status: 'failed', error: 'invalid_action_config', finished_at: new Date().toISOString() }).eq('id', stepId);
        continue;
      }

      // Ejecutar acción (v1: outbox)
      if (cfg.action === 'action.send_email') {
        const ins = await sb.from('workflow_message_outbox').insert({
          workspace_id: run.workspace_id,
          run_id: run.id,
          step_id: stepId,
          channel: 'email',
          to: cfg.to,
          payload: { subject: cfg.subject, body: cfg.body, context: run.context },
          status: 'queued',
        });
        if (ins.error) throw new Error(ins.error.message);

        await sb
          .from('workflow_run_steps')
          .update({ status: 'success', output: { enqueued: true, channel: 'email' }, finished_at: new Date().toISOString() })
          .eq('id', stepId);
      } else if (cfg.action === 'action.send_sms') {
        const ins = await sb.from('workflow_message_outbox').insert({
          workspace_id: run.workspace_id,
          run_id: run.id,
          step_id: stepId,
          channel: 'sms',
          to: cfg.to,
          payload: { body: cfg.body, context: run.context },
          status: 'queued',
        });
        if (ins.error) throw new Error(ins.error.message);

        await sb
          .from('workflow_run_steps')
          .update({ status: 'success', output: { enqueued: true, channel: 'sms' }, finished_at: new Date().toISOString() })
          .eq('id', stepId);
      } else if (cfg.action === 'lead.add_label') {
        // Stub (lo conectas a tu modelo real si quieres)
        await sb
          .from('workflow_run_steps')
          .update({ status: 'success', output: { applied: false, action: 'lead.add_label', label: cfg.label }, finished_at: new Date().toISOString() })
          .eq('id', stepId);
      }

      // Encadenar siguientes steps
      const nextNodes = nextMap.get(nodeId) ?? [];
      if (nextNodes.length > 0) {
        const inserts = nextNodes.map((nid) => ({
          run_id: run.id,
          node_id: nid,
          status: 'queued',
          scheduled_for: new Date().toISOString(),
        }));

        const insNext = await sb.from('workflow_run_steps').insert(inserts);
        if (insNext.error) throw new Error(insNext.error.message);
      }

      processed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error';
      await sb.from('workflow_run_steps').update({ status: 'failed', error: msg, finished_at: new Date().toISOString() }).eq('id', stepId);
    }
  }

  return json(200, { ok: true, processed });
}