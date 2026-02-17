// src/lib/supabaseClient.ts
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL');
if (!supabaseAnonKey) throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY');

// Singleton en browser (evita múltiples instancias)
let browserClient: SupabaseClient | null = null;

export const supabase: SupabaseClient =
  browserClient ??
  (browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // mantenemos tus defaults
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }));
