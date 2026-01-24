// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// ⚠️ Import relativo (edge-safe)
import { DEFAULT_LOCALE, isAppLocale } from './src/i18n/config';

function isPublicAsset(pathname: string): boolean {
  if (pathname.startsWith('/_next')) return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname.startsWith('/brand/')) return true;
  return /\.(png|jpg|jpeg|gif|svg|webp|ico|txt|xml|json|map)$/i.test(pathname);
}

function isProtectedPath(pathname: string): boolean {
  return (
    pathname === '/onboarding' ||
    pathname.startsWith('/inbox') ||
    pathname.startsWith('/leads') ||
    pathname.startsWith('/pipeline') ||
    pathname.startsWith('/integrations') ||
    pathname.startsWith('/campaigns') ||
    pathname.startsWith('/settings')
  );
}

function ensureLocaleCookie(req: NextRequest, res: NextResponse) {
  const raw = req.cookies.get('NEXT_LOCALE')?.value;
  if (isAppLocale(raw)) return;

  res.cookies.set('NEXT_LOCALE', DEFAULT_LOCALE, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  const res = NextResponse.next();
  ensureLocaleCookie(req, res);

  // público (incluye "/")
  if (!isProtectedPath(pathname)) {
    return res;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.searchParams.set('next', `${req.nextUrl.pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
