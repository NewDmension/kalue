import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getBearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ ok: false, error: 'No auth' }, { status: 401 });

  const { id } = await ctx.params;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ ok: false, error: 'Missing Supabase env' }, { status: 500 });

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { error } = await supabase
    .from('leads')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
