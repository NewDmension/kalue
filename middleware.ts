// src/middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import createIntlMiddleware from 'next-intl/middleware';
import { DEFAULT_LOCALE, LOCALES, isAppLocale } from '@/i18n/config';

function isPublicAsset(pathname: string): boolean {
  if (pathname.startsWith('/_next')) return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname.startsWith('/brand/')) return true;
  return /\.(png|jpg|jpeg|gif|svg|webp|ico|txt|xml|json|map)$/i.test(pathname);
}

const intl = createIntlMiddleware({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'never',
  localeDetection: false,
});

function ensureLocaleCookie(req: NextRequest, res: NextResponse) {
  const raw = req.cookies.get('NEXT_LOCALE')?.value;
  if (isAppLocale(raw)) return;

  res.cookies.set('NEXT_LOCALE', DEFAULT_LOCALE, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
}

function isPublicRoute(pathname: string): boolean {
  // públicas: login y auth callbacks
  if (pathname === '/') return true;
  if (pathname.startsWith('/auth')) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (isPublicAsset(pathname)) return NextResponse.next();

  // i18n
  const res = intl(req);
  ensureLocaleCookie(req, res);

  // auth gate para todo lo que NO sea público
  if (isPublicRoute(pathname)) return res;

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
