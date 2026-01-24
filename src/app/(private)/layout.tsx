// src/app/(private)/layout.tsx
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

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  // Si no hay user, devolvemos children (tu middleware/layout de onboarding ya decide redirecciones)
  if (!user) return <>{props.children}</>;

  const { data: membershipsRaw, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces:workspaces(id, name, slug)')
    .eq('user_id', user.id);

  if (error) {
    // No petamos render por esto
    console.error('[private-layout] memberships query error', error);
  }

  const initialMemberships: MembershipRow[] = isMembershipRowArray(membershipsRaw)
    ? membershipsRaw
    : [];

  return <AppShell initialMemberships={initialMemberships}>{props.children}</AppShell>;
}
