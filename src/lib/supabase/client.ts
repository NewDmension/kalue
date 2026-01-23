import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabaseBrowser = createBrowserClient(supabaseUrl, supabaseAnonKey);

// Alias opcional para imports nuevos (si ya lo usas en /auth)
export const supabase = supabaseBrowser;
