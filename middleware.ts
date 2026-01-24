import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

function isPublicAsset(pathname: string): boolean {
  if (pathname.startsWith('/_next')) return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname.startsWith('/brand/')) return true;

  return /\.(png|jpg|jpeg|gif|svg|webp|ico|txt|xml|json|map)$/i.test(pathname);
}

function isProtectedPath(pathname: string): boolean {
  // ✅ Tus rutas privadas reales (sin /app)
  return (
    pathname === '/onboarding' ||
    pathname.startsWith('/onboarding/') ||
    pathname === '/inbox' ||
    pathname.startsWith('/inbox/') ||
    pathname === '/leads' ||
    pathname.startsWith('/leads/') ||
    pathname === '/pipeline' ||
    pathname.startsWith('/pipeline/') ||
    pathname === '/integrations' ||
    pathname.startsWith('/integrations/') ||
    pathname === '/campaigns' ||
    pathname.startsWith('/campaigns/') ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/')
  );
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // 0) Nunca interceptar assets
  if (isPublicAsset(pathname)) return NextResponse.next();

  // 1) Si no es privada, no tocamos nada (incluye "/")
  if (!isProtectedPath(pathname)) return NextResponse.next();

  // 2) Proteger rutas privadas con Supabase
  const res = NextResponse.next();

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

    // vuelve exactamente donde ibas
    const fullNext = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    url.searchParams.set('next', fullNext);

    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  // ✅ Solo corre en privadas (NO corre en "/")
  matcher: [
    '/onboarding/:path*',
    '/inbox/:path*',
    '/leads/:path*',
    '/pipeline/:path*',
    '/integrations/:path*',
    '/campaigns/:path*',
    '/settings/:path*',
  ],
};
