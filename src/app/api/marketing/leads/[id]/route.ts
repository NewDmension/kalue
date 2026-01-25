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
};

type Ok = { ok: true; lead: LeadRow };
type Err = { ok: false; error: string };

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const sb = supabaseAdmin();
  if (!sb) {
    return NextResponse.json<Err>({ ok: false, error: 'Missing Supabase env vars.' }, { status: 500 });
  }

  const { data, error } = await sb
    .from('leads')
    .select('id,created_at,source,full_name,phone,email,profession,biggest_pain,status,labels,notes')
    .eq('id', id)
    .maybeSingle<LeadRow>();

  if (error) {
    return NextResponse.json<Err>({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json<Err>({ ok: false, error: 'Lead not found.' }, { status: 404 });
  }

  return NextResponse.json<Ok>({ ok: true, lead: data });
}
