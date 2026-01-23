import { NextResponse, type NextRequest } from 'next/server';
import { supabaseRoute } from '@/lib/supabase/server-route';

type Body = { email: string; password: string };

function isBody(v: unknown): v is Body {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.email === 'string' && typeof r.password === 'string';
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const next = url.searchParams.get('next') ?? '/app';

  const body = (await req.json().catch(() => null)) as unknown;
  if (!isBody(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const { supabase, res } = supabaseRoute(req);

  const { error } = await supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
  }

  // OJO: devolvemos usando `res` para que incluya Set-Cookie
  return NextResponse.json({ ok: true, next }, { headers: res.headers });
}
