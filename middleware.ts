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

// Rutas públicas (no requieren auth)
function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true;

  // endpoints auth (si los usas)
  if (pathname.startsWith('/auth')) return true;

  return false;
}

const intlMiddleware = createIntlMiddleware({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'never',
  localeDetection: false, // lo controlas con cookie
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

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // 0) Nunca interceptar assets
  if (isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  // 1) i18n
  const res = intlMiddleware(req);
  ensureLocaleCookie(req, res);

  // 2) si es público, no hacemos auth
  if (isPublicPath(pathname)) return res;

  // 3) Auth para TODO lo demás (tu “(private)” real)
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
    const fullNext = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    url.searchParams.set('next', fullNext);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
