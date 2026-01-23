import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

type MembershipRow = {
  workspace_id: string;
};

export default async function AppIndexPage() {
  const supabase = await supabaseServer();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect('/auth');

  const { data: memberships, error } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .limit(1);

  if (error) {
    // Si RLS bloquea o falta tabla, que no pete silencioso:
    redirect('/app/onboarding');
  }

  if (!memberships || memberships.length === 0) {
    redirect('/app/onboarding');
  }

  redirect('/app/inbox');
}
