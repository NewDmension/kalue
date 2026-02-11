import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { decryptToken } from '@/server/crypto/tokenCrypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getWorkspaceId(req: Request): string {
  const v = req.headers.get('x-workspace-id');
  if (!v) throw new Error('Missing x-workspace-id header');
  return v;
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

type TokenRow = { access_token_ciphertext: string | null };

type ListResp<T> = { data?: T[]; paging?: unknown };

type Business = { id?: string; name?: string };
type Page = { id?: string; name?: string };

async function graphGet<T>(path: string, accessToken: string): Promise<{ ok: boolean; status: number; json: T }> {
  const url = new URL(`https://graph.facebook.com/v19.0/${path}`);
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url.toString(), { method: 'GET' });
  const json = (await res.json()) as T;
  return { ok: res.ok, status: res.status, json };
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
    const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const wsId = getWorkspaceId(req);

    const cookieStore = await cookies();
    const supabaseServer = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    });

    const { data: userData, error: userErr } = await supabaseServer.auth.getUser();
    if (userErr || !userData.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = userData.user.id;

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: member } = await admin
      .from('workspace_members')
      .select('workspace_id,user_id')
      .eq('workspace_id', wsId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data: integration } = await admin
      .from('integrations')
      .select('id,status')
      .eq('workspace_id', wsId)
      .eq('provider', 'meta')
      .maybeSingle();

    if (!integration) return NextResponse.json({ error: 'Meta not connected' }, { status: 400 });

    const { data: trow } = await admin
      .from('integration_oauth_tokens')
      .select('access_token_ciphertext')
      .eq('workspace_id', wsId)
      .eq('integration_id', integration.id)
      .eq('provider', 'meta')
      .order('obtained_at', { ascending: false })
      .limit(1)
      .maybeSingle<TokenRow>();

    const ciphertext = trow?.access_token_ciphertext ?? null;
    if (!ciphertext) return NextResponse.json({ error: 'Missing oauth token' }, { status: 400 });

    const accessToken = decryptToken(ciphertext);
    if (!accessToken) return NextResponse.json({ error: 'Failed to decrypt token' }, { status: 400 });

    // 1) businesses
    const businessesRes = await graphGet<ListResp<Business>>('me/businesses?fields=id,name', accessToken);
    if (!businessesRes.ok) {
      return NextResponse.json({ error: 'Failed /me/businesses', meta: businessesRes.json }, { status: 400 });
    }

    const businesses = (businessesRes.json.data ?? [])
      .map((b) => {
        const id = pickString(b.id);
        const name = pickString(b.name);
        return id ? { id, name: name ?? id } : null;
      })
      .filter((v): v is { id: string; name: string } => v !== null);

    // 2) owned pages per business
    const results: Array<{
      business: { id: string; name: string };
      ownedPagesCount: number;
      ownedPages: Array<{ id: string; name: string }>;
      error: unknown | null;
    }> = [];

    for (const b of businesses) {
      const owned = await graphGet<ListResp<Page>>(`${b.id}/owned_pages?fields=id,name`, accessToken);
      if (!owned.ok) {
        results.push({ business: b, ownedPagesCount: 0, ownedPages: [], error: owned.json });
        continue;
      }

      const pages = (owned.json.data ?? [])
        .map((p) => {
          const id = pickString(p.id);
          const name = pickString(p.name);
          return id && name ? { id, name } : null;
        })
        .filter((v): v is { id: string; name: string } => v !== null);

      results.push({ business: b, ownedPagesCount: pages.length, ownedPages: pages.slice(0, 50), error: null });
    }

    const totalPages = results.reduce((acc, r) => acc + r.ownedPagesCount, 0);

    return NextResponse.json({
      businessesCount: businesses.length,
      totalOwnedPages: totalPages,
      results,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
