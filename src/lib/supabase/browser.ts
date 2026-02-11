import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (client) return client;

  client = createClient(
    getEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { persistSession: true } }
  );

  return client;
}
