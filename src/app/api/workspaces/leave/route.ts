import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getBearerToken(req: Request): string {
  const h = req.headers.get('authorization');
  if (!h) throw new Error('Missing Authorization header');
  const [kind, token] = h.split(' ');
  if (kind !== 'Bearer' || !token) throw new Error('Invalid Authorization header');
  return token;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearerToken(req);

    const bodyUnknown: unknown = await req.json();
    if (!isRecord(bodyUnknown)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

    const workspaceId = typeof bodyUnknown.workspace_id === 'string' ? bodyUnknown.workspace_id : '';
    if (!workspaceId) return NextResponse.json({ error: 'Missing workspace_id' }, { status: 400 });

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = userData.user.id;

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: me } = await supabaseAdmin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 400 });

    // No permitir que el owner se vaya (para MVP)
    if (String(me.role) === 'owner') {
      return NextResponse.json({ error: 'Owner cannot leave workspace. Transfer ownership or delete workspace.' }, { status: 400 });
    }

    const { error: delErr } = await supabaseAdmin
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId);

    if (delErr) return NextResponse.json({ error: 'Failed to leave', detail: delErr.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
