import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_URL');
if (!supabaseAnonKey) throw new Error('Missing env: NEXT_PUBLIC_SUPABASE_ANON_KEY');

// Singleton en browser (evita múltiples instancias)
let browserClient: SupabaseClient | null = null;

export const supabase: SupabaseClient =
  browserClient ??
  (browserClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      // defaults útiles, explícitos
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }));
