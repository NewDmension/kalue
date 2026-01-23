import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import AppShell from '@/components/app/AppShell';

export default async function AppLayout(props: { children: React.ReactNode }) {
  const supabase = supabaseServer();
  const { data } = await supabase.auth.getUser();

  const user = data.user;
  if (!user) redirect('/auth');

  // ✅ ¿Tiene al menos 1 workspace?
  const { data: memberships, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces(id, name, slug)')
    .order('created_at', { ascending: true });

  const hasWorkspace = !!memberships && memberships.length > 0;

  // Si no tiene ninguno, forzamos onboarding
  if (!hasWorkspace) {
    // Permitimos entrar a onboarding sin loop
    // Si ya estás en /app/onboarding, ok.
    // Este layout se aplica a /app/*, así que lo gestionamos por pathname desde client.
    // En SSR no tenemos pathname aquí, así que lo resolvemos con un layout específico en onboarding (abajo).
  }

  return <AppShell initialMemberships={memberships ?? []}>{props.children}</AppShell>;
}
