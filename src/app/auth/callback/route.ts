import { NextResponse, type NextRequest } from 'next/server';
import { createRouteHandlerClient } from '@supabase/ssr';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/app';

  // Si no hay code, vuelve a /auth (evita pantallas raras)
  if (!code) {
    const redirectUrl = new URL('/auth', url.origin);
    redirectUrl.searchParams.set('error', 'missing_code');
    return NextResponse.redirect(redirectUrl);
  }

  const res = NextResponse.redirect(new URL(next, url.origin));

  const supabase = createRouteHandlerClient(
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    },
    {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const redirectUrl = new URL('/auth', url.origin);
    redirectUrl.searchParams.set('error', 'callback_exchange_failed');
    return NextResponse.redirect(redirectUrl);
  }

  return res;
}
