import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

function isPublicAsset(pathname: string): boolean {
  if (pathname.startsWith('/_next')) return true;
  if (pathname === '/favicon.ico') return true;
  if (pathname.startsWith('/brand/')) return true;

  // extensiones típicas de assets
  return /\.(png|jpg|jpeg|gif|svg|webp|ico|txt|xml|json|map)$/i.test(pathname);
}

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // Nunca interceptar assets
  if (isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  const res = NextResponse.next();

  const isProtected = pathname.startsWith('/app');
  if (!isProtected) return res;

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
    url.pathname = '/auth';

    // Guarda ruta exacta (path + query) para volver
    const fullNext = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    url.searchParams.set('next', fullNext);

    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ['/app/:path*'],
};
