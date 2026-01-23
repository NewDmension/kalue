import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export default async function OnboardingLayout(props: { children: React.ReactNode }) {
  const supabase = supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/auth');

  // Si ya tiene workspace, fuera de onboarding
  const { data: memberships } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .limit(1);

  if (memberships && memberships.length > 0) redirect('/app/inbox');

  return <>{props.children}</>;
}
