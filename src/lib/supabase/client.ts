import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function supabaseBrowser(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return createBrowserClient(url, key);
}
