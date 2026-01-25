import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

type LeadRow = {
  id: string;
  created_at: string;
  source: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  profession: string | null;
  biggest_pain: string | null;
  status: string;
  labels: string[] | null;
  notes: string | null;
  read_at: string | null;
};

function getBearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function GET(req: Request) {
  const token = getBearerToken(req);
  if (!token) return NextResponse.json({ ok: false, error: 'No auth' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json({ ok: false, error: 'Missing Supabase env' }, { status: 500 });
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await supabase
    .from('leads')
    .select('id, created_at, source, full_name, phone, email, profession, biggest_pain, status, labels, notes, read_at')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  const leads = (Array.isArray(data) ? data : []) as LeadRow[];
  return NextResponse.json({ ok: true, leads });
}
