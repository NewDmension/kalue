import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

type SignUpBody = {
  email: string;
  password: string;
};

function isSignUpBody(value: unknown): value is SignUpBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.email === 'string' && typeof v.password === 'string';
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const next = url.searchParams.get('next') ?? '/app';

  const json = (await req.json().catch(() => null)) as unknown;
  if (!isSignUpBody(json)) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kalue.vercel.app';

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

  const { error } = await supabase.auth.signUp({
    email: json.email,
    password: json.password,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  return res;
}
