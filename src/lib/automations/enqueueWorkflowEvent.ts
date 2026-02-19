// src/lib/automations/enqueueWorkflowEvent.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { [k: string]: JsonValue } | JsonValue[];

type EnqueueArgs = {
  workspaceId: string;
  eventType: string;
  entityId: string;
  payload: Record<string, JsonValue>;
};

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function createServiceClient(): SupabaseClient {
  const url = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

export async function enqueueWorkflowEvent(args: EnqueueArgs): Promise<void> {
  const svc = createServiceClient();

  const { error } = await svc.from('workflow_event_queue').insert({
    workspace_id: args.workspaceId,
    event_type: args.eventType,
    entity_id: args.entityId,
    payload: args.payload,
  });

  if (error) throw new Error(`enqueue_workflow_event_failed: ${error.message}`);
}
