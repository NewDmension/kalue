// src/app/(private)/layout.tsx
import { redirect } from 'next/navigation';
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

export default async function PrivateLayout(props: { children: React.ReactNode }) {
  const supabase = await supabaseServer();

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData.user;

  // ✅ No user => login (tu login vive en '/')
  if (userErr || !user) redirect('/');

  const { data: membershipsRaw, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces:workspaces(id, name, slug)')
    .eq('user_id', user.id);

  if (error) {
    console.error('[private-layout] memberships query error', error);
    // Si hay error real (RLS/tabla/etc), mandamos a onboarding igualmente
    redirect('/onboarding');
  }

  const initialMemberships: MembershipRow[] = isMembershipRowArray(membershipsRaw)
    ? membershipsRaw
    : [];

  // ✅ Si no tiene workspaces aún => onboarding (crear workspace + membership)
  if (initialMemberships.length === 0) redirect('/onboarding');

  return <AppShell initialMemberships={initialMemberships}>{props.children}</AppShell>;
}
