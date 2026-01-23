import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

type SignInBody = {
  email: string;
  password: string;
};

function isSignInBody(value: unknown): value is SignInBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.email === 'string' && typeof v.password === 'string';
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const next = url.searchParams.get('next') ?? '/app';

  const json = (await req.json().catch(() => null)) as unknown;
  if (!isSignInBody(json)) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

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
    email: json.email,
    password: json.password,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 401 });
  }

  return res;
}
