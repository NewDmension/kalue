// src/lib/automations/triggers/triggerLeadStageChanged.ts
import { supabase } from '@/lib/supabaseClient';
import { getActiveWorkspaceId } from '@/lib/activeWorkspace';

export type TriggerLeadStageChangedArgs = {
  leadId: string;
  pipelineId: string;
  fromStageId: string | null;
  toStageId: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export async function triggerLeadStageChanged(args: TriggerLeadStageChangedArgs): Promise<void> {
  const ws = await getActiveWorkspaceId();
  const { data, error } = await supabase.auth.getSession();

  if (error) return;

  const token = data.session?.access_token ?? null;
  if (!ws || !token) return;

  const res = await fetch('/api/automations/triggers/lead-stage-changed', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-workspace-id': ws,
    },
    body: JSON.stringify({
      workspaceId: ws,
      leadId: args.leadId,
      pipelineId: args.pipelineId,
      fromStageId: args.fromStageId ?? undefined,
      toStageId: args.toStageId,
    }),
  });

  // no rompemos UX si falla
  const text = await res.text();
  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.error('triggerLeadStageChanged failed', res.status, text);
    return;
  }

  try {
    const j = text ? (JSON.parse(text) as unknown) : null;
    if (isRecord(j) && j.ok !== true) {
      // eslint-disable-next-line no-console
      console.warn('triggerLeadStageChanged responded not-ok', j);
    }
  } catch {
    // ignore
  }
}