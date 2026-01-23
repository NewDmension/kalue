import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export const runtime = 'nodejs';

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

  // IMPORTANTÍSIMO: creamos la respuesta OK primero y es ESA la que recibirá Set-Cookie
  const res = NextResponse.json({ ok: true, next });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const { error } = await supabase.auth.signInWithPassword({
    email: body.email,
    password: body.password,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
  }

  // devolvemos EXACTAMENTE el `res` que tiene las cookies
  return res;
}
