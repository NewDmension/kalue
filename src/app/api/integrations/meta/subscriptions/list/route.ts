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

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const integrationId = (url.searchParams.get('integrationId') ?? '').trim();
  const workspaceId = (req.headers.get('x-workspace-id') ?? '').trim();

  if (!workspaceId) return NextResponse.json({ ok: false, error: 'missing_workspace' }, { status: 400 });
  if (!integrationId || !isUuid(integrationId)) {
    return NextResponse.json({ ok: false, error: 'invalid_integration_id' }, { status: 400 });
  }

  const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await admin
    .from('integration_meta_webhook_subscriptions')
    .select('id, workspace_id, integration_id, page_id, form_id, status, webhook_subscribed, page_name, form_name, created_at, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('integration_id', integrationId)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: 'db_error', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, subscriptions: data ?? [] });
}
