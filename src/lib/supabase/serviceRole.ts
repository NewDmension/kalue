// src/lib/supabase/serviceRole.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export function supabaseServiceRole(): SupabaseClient {
  const url = mustEnv('NEXT_PUBLIC_SUPABASE_URL');
  const key = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}