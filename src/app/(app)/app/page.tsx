import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export default async function AppIndexPage() {
 const supabase = await supabaseServer();


  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/auth');

  const { data: memberships } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .limit(1);

  if (!memberships || memberships.length === 0) redirect('/app/onboarding');

  redirect('/app/inbox');
}
