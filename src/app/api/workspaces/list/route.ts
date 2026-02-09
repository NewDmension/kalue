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

function getString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function getBearerToken(req: Request): string {
  const h = req.headers.get('authorization');
  if (!h) throw new Error('Missing Authorization header');
  const [kind, token] = h.split(' ');
  if (kind !== 'Bearer' || !token) throw new Error('Invalid Authorization header');
  return token;
}

type MemberRow = {
  workspace_id: string;
  role: string;
};

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  created_by: string;
};

function parseMemberRows(data: unknown): MemberRow[] {
  if (!Array.isArray(data)) return [];
  const out: MemberRow[] = [];

  for (const item of data) {
    if (!isRecord(item)) continue;
    const workspaceId = getString(item.workspace_id);
    const role = getString(item.role) ?? 'member';
    if (!workspaceId) continue;
    out.push({ workspace_id: workspaceId, role });
  }

  return out;
}

function parseWorkspaceRows(data: unknown): WorkspaceRow[] {
  if (!Array.isArray(data)) return [];
  const out: WorkspaceRow[] = [];

  for (const item of data) {
    if (!isRecord(item)) continue;

    const id = getString(item.id);
    const name = getString(item.name);
    const slug = getString(item.slug);
    const createdAt = getString(item.created_at);
    const createdBy = getString(item.created_by);

    if (!id || !name || !slug || !createdAt || !createdBy) continue;

    out.push({
      id,
      name,
      slug,
      created_at: createdAt,
      created_by: createdBy,
    });
  }

  return out;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const token = getBearerToken(req);

    // 1) Validar usuario (JWT)
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData.user) {
      return NextResponse.json({ error: 'Para ver Workspaces necesitas iniciar sesión.' }, { status: 401 });
    }
    const userId = userData.user.id;

    // 2) Admin client
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // 3) Sacar memberships del user
    const membersRes = await supabaseAdmin
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', userId);

    if (membersRes.error) {
      return NextResponse.json(
        { error: 'Failed to load workspaces', detail: membersRes.error.message },
        { status: 400 }
      );
    }

    const members = parseMemberRows(membersRes.data as unknown);

    if (members.length === 0) {
      return NextResponse.json({ workspaces: [] }, { status: 200 });
    }

    const workspaceIds = Array.from(new Set(members.map((m) => m.workspace_id)));

    // 4) Cargar workspaces
    const wsRes = await supabaseAdmin
      .from('workspaces')
      .select('id, name, slug, created_at, created_by')
      .in('id', workspaceIds)
      .order('created_at', { ascending: true });

    if (wsRes.error) {
      return NextResponse.json(
        { error: 'Failed to load workspaces', detail: wsRes.error.message },
        { status: 400 }
      );
    }

    const workspaces = parseWorkspaceRows(wsRes.data as unknown);

    // 5) Unir role + workspace
    const roleByWs = new Map<string, string>();
    for (const m of members) roleByWs.set(m.workspace_id, m.role);

    const merged = workspaces.map((w) => ({
      ...w,
      role: roleByWs.get(w.id) ?? 'member',
    }));

    return NextResponse.json({ workspaces: merged }, { status: 200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to load workspaces', detail: msg }, { status: 400 });
  }
}
