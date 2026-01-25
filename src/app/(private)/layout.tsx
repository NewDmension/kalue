// src/app/(private)/layout.tsx
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import AppShell from '@/components/app/AppShell';
import { supabaseServer } from '@/lib/supabase/server';

type Workspace = { id: string; name: string; slug: string };

type MembershipRow = {
  workspace_id: string;
  role: 'owner' | 'admin' | 'member';
  workspaces: Workspace | null;
};

function isMembershipRowArray(value: unknown): value is MembershipRow[] {
  if (!Array.isArray(value)) return false;

  return value.every((v) => {
    if (typeof v !== 'object' || v === null) return false;
    const r = v as Record<string, unknown>;

    const roleOk = r.role === 'owner' || r.role === 'admin' || r.role === 'member';
    const wsIdOk = typeof r.workspace_id === 'string';

    const w = r.workspaces;
    const wOk =
      w === null ||
      (typeof w === 'object' &&
        w !== null &&
        typeof (w as Record<string, unknown>).id === 'string' &&
        typeof (w as Record<string, unknown>).name === 'string' &&
        typeof (w as Record<string, unknown>).slug === 'string');

    return roleOk && wsIdOk && wOk;
  });
}

function getPathnameFromHeaders(): string {
  // Next suele exponer `next-url` en headers durante el render server.
  // Si no existe, devolvemos '' (fallback).
  const h = headers();
  const nextUrl = h.get('next-url') ?? '';

  if (!nextUrl) return '';
  try {
    // A veces viene como URL absoluta
    if (nextUrl.startsWith('http://') || nextUrl.startsWith('https://')) {
      return new URL(nextUrl).pathname;
    }
    return nextUrl; // a veces ya es pathname
  } catch {
    return '';
  }
}

export default async function PrivateLayout(props: { children: React.ReactNode }) {
  const supabase = await supabaseServer();

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData.user;

  // ✅ Sin user => login
  if (userErr || !user) redirect('/');

  const pathname = getPathnameFromHeaders();
  const isOnboardingRoute = pathname === '/onboarding' || pathname.startsWith('/onboarding/');

  const { data: membershipsRaw, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces:workspaces(id, name, slug)')
    .eq('user_id', user.id);

  if (error) {
    console.error('[private-layout] memberships query error', error);
    // Si estamos en onboarding, dejamos renderizar para poder crear workspace.
    if (!isOnboardingRoute) redirect('/onboarding');
  }

  const initialMemberships: MembershipRow[] = isMembershipRowArray(membershipsRaw)
    ? membershipsRaw
    : [];

  // ✅ Si no tiene memberships:
  // - En /onboarding: permitimos entrar (para crear workspace)
  // - En el resto: forzamos onboarding
  if (initialMemberships.length === 0 && !isOnboardingRoute) {
    redirect('/onboarding');
  }

  // ✅ AppShell visible siempre (incluido onboarding)
  return <AppShell initialMemberships={initialMemberships}>{props.children}</AppShell>;
}
