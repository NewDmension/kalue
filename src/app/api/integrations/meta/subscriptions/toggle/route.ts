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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

type Body = {
  integrationId: string;
  subscriptionId: string;
  enabled: boolean;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();
  if (!workspaceId) return NextResponse.json({ ok: false, error: 'missing_workspace' }, { status: 400 });

  let bodyUnknown: unknown;
  try {
    bodyUnknown = (await req.json()) as unknown;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  if (!isRecord(bodyUnknown)) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });

  const integrationId = typeof bodyUnknown.integrationId === 'string' ? bodyUnknown.integrationId : '';
  const subscriptionId = typeof bodyUnknown.subscriptionId === 'string' ? bodyUnknown.subscriptionId : '';
  const enabled = typeof bodyUnknown.enabled === 'boolean' ? bodyUnknown.enabled : false;

  if (!integrationId || !isUuid(integrationId)) {
    return NextResponse.json({ ok: false, error: 'invalid_integration_id' }, { status: 400 });
  }
  if (!subscriptionId || !isUuid(subscriptionId)) {
    return NextResponse.json({ ok: false, error: 'invalid_subscription_id' }, { status: 400 });
  }

  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Política: togglear solo filas del workspace + integración actual
  const patch: Record<string, unknown> = enabled
    ? { status: 'active', webhook_subscribed: true }
    : { status: 'paused', webhook_subscribed: false };

  const { error } = await admin
    .from('integration_meta_webhook_subscriptions')
    .update(patch)
    .eq('id', subscriptionId)
    .eq('workspace_id', workspaceId)
    .eq('integration_id', integrationId);

  if (error) {
    return NextResponse.json({ ok: false, error: 'db_error', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
