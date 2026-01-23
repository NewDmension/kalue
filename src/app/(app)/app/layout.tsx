import { redirect } from 'next/navigation';
import AppShell from '@/components/app/AppShell';
import { supabaseServer } from '@/lib/supabase/server';

type Workspace = { id: string; name: string; slug: string };

type MembershipRow = {
  workspace_id: string;
  role: 'owner' | 'admin' | 'member';
  workspaces: Workspace | null;
};

// Supabase join suele devolver arrays, no objeto.
type MembershipRaw = {
  workspace_id: string;
  role: string;
  workspaces: Array<{ id: string; name: string; slug: string }> | null;
};

function toMembershipRow(raw: MembershipRaw): MembershipRow {
  const wsArr = Array.isArray(raw.workspaces) ? raw.workspaces : [];
  const ws0 = wsArr.length > 0 ? wsArr[0] : null;

  const role =
    raw.role === 'owner' || raw.role === 'admin' || raw.role === 'member' ? raw.role : 'member';

  return {
    workspace_id: raw.workspace_id,
    role,
    workspaces: ws0
      ? { id: ws0.id, name: ws0.name, slug: ws0.slug }
      : null,
  };
}

export default async function AppLayout(props: { children: React.ReactNode }) {
  const supabase = await supabaseServer();

  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect('/auth');

  const { data: rawMemberships, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces(id, name, slug)')
    .order('created_at', { ascending: true });

  if (error) {
    // Si hay error de RLS o schema, preferimos no romper layout
    return <AppShell initialMemberships={[]}>{props.children}</AppShell>;
  }

  const safeRaw: MembershipRaw[] = Array.isArray(rawMemberships) ? (rawMemberships as MembershipRaw[]) : [];
  const memberships: MembershipRow[] = safeRaw.map(toMembershipRow);

  return <AppShell initialMemberships={memberships}>{props.children}</AppShell>;
}
