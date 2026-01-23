import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            for (const c of cookiesToSet) {
              cookieStore.set(c.name, c.value, c.options);
            }
          } catch {
            // En Server Components, set puede fallar si no estás en una Route Handler.
            // Lo ignoramos; Supabase lo reintentará donde proceda (middleware/route).
          }
        },
      },
    }
  );
}
