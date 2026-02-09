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

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

type CreateWorkspaceBody = { name: string };

// ⚠️ Ajusta este valor si tu enum role no usa "owner"
const ROLE_OWNER = 'owner';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearerToken(req);

    const bodyUnknown: unknown = await req.json();
    if (!isRecord(bodyUnknown)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

    const name = typeof bodyUnknown.name === 'string' ? bodyUnknown.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });

    // 1) Validate user via JWT
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData.user) return NextResponse.json({ error: 'Unauthorized', detail: userErr?.message ?? null }, { status: 401 });
    const userId = userData.user.id;

    // 2) Create with service role
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const base = slugify(name) || `ws-${userId.slice(0, 8)}`;

    // Intentamos slug base y si choca, añadimos sufijo
    let createdWorkspaceId: string | null = null;
    let createdWorkspace: { id: string; name: string; slug: string } | null = null;

    for (let i = 0; i < 5; i += 1) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`;

      const { data: ws, error: wsErr } = await supabaseAdmin
        .from('workspaces')
        .insert({ name, slug: candidate, created_by: userId })
        .select('id,name,slug')
        .single();

      if (!wsErr && ws) {
        createdWorkspaceId = ws.id;
        createdWorkspace = ws;
        break;
      }

      // si no es conflicto de unique, salimos
      const msg = wsErr?.message ?? '';
      const isUnique = msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('unique');
      if (!isUnique) {
        return NextResponse.json({ error: 'Failed to create workspace', detail: wsErr?.message ?? null }, { status: 400 });
      }
    }

    if (!createdWorkspaceId || !createdWorkspace) {
      return NextResponse.json({ error: 'Failed to create workspace', detail: 'slug_conflict' }, { status: 400 });
    }

    const { error: memErr } = await supabaseAdmin.from('workspace_members').insert({
      workspace_id: createdWorkspaceId,
      user_id: userId,
      role: ROLE_OWNER,
    });

    if (memErr) {
      return NextResponse.json(
        { error: 'Failed to create membership', detail: memErr.message, workspace_id: createdWorkspaceId },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true, workspace: createdWorkspace });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
