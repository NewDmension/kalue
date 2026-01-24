import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export default async function OnboardingLayout(props: { children: React.ReactNode }) {
  const supabase = await supabaseServer();

  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/auth');

  return <div className="min-h-screen w-full">{props.children}</div>;
}
