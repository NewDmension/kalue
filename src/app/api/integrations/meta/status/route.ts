import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Json = Record<string, unknown>;

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getBearerToken(req: Request): string {
  const h = req.headers.get('authorization');
  if (!h) throw new Error('Missing Authorization header');
  const [kind, token] = h.split(' ');
  if (kind !== 'Bearer' || !token) throw new Error('Invalid Authorization header');
  return token;
}

function getWorkspaceId(req: Request): string {
  const v = req.headers.get('x-workspace-id');
  if (!v) throw new Error('Missing x-workspace-id header');
  return v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickConfig(config: unknown): { step: string | null; page_id: string | null; page_name: string | null } {
  if (!isRecord(config)) return { step: null, page_id: null, page_name: null };
  const step = typeof config.step === 'string' ? config.step : null;
  const page_id = typeof config.page_id === 'string' ? config.page_id : null;
  const page_name = typeof config.page_name === 'string' ? config.page_name : null;
  return { step, page_id, page_name };
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearerToken(req);
    const workspaceId = getWorkspaceId(req);

    // auth user
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = userData.user.id;

    // membership check
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: member } = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id,user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // integration
    const { data: integration } = await supabaseAdmin
      .from('integrations')
      .select('id, status, connected_at, updated_at, config')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'meta')
      .maybeSingle();

    if (!integration) {
      return NextResponse.json({
        exists: false,
        status: 'disconnected',
        config: { step: null, page_id: null, page_name: null },
      });
    }

    const cfg = pickConfig(integration.config);

    return NextResponse.json({
      exists: true,
      id: integration.id,
      status: typeof integration.status === 'string' ? integration.status : 'unknown',
      connected_at: integration.connected_at ?? null,
      updated_at: integration.updated_at ?? null,
      config: cfg,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
