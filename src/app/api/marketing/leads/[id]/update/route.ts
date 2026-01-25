import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type UpdateBody = {
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  profession?: string | null;
  biggest_pain?: string | null;
  status?: string | null;
  notes?: string | null;
  labels?: string[] | null;
};

function getBearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ ok: false, error: 'No auth' }, { status: 401 });

  const { id } = await ctx.params;

  const bodyUnknown: unknown = await req.json().catch(() => null);
  if (!bodyUnknown || typeof bodyUnknown !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }
  const body = bodyUnknown as UpdateBody;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ ok: false, error: 'Missing Supabase env' }, { status: 500 });

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const patch: Record<string, unknown> = {};
  for (const k of ['full_name','phone','email','profession','biggest_pain','status','notes','labels'] as const) {
    if (k in body) patch[k] = body[k];
  }

  const { data, error } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, lead: data });
}
