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

const intlMiddleware = createIntlMiddleware({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'never',
  localeDetection: false, // controlado por cookie
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

  // Nunca interceptar assets
  if (isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  // 1) i18n (no reescribe URLs, sólo prepara locale/mensajes)
  const intlRes = intlMiddleware(req);
  ensureLocaleCookie(req, intlRes);

  // 2) Auth sólo para /app
  const isProtected = pathname.startsWith('/app');
  if (!isProtected) return intlRes;

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
            intlRes.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    const url = req.nextUrl.clone();
    url.pathname = '/auth';

    // Guarda ruta exacta (path + query) para volver
    const fullNext = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    url.searchParams.set('next', fullNext);

    return NextResponse.redirect(url);
  }

  return intlRes;
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
