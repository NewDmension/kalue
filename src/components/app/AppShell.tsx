'use client';

import { useMemo, useState } from 'react';
import {
  Inbox,
  Users,
  Workflow,
  Plug,
  Megaphone,
  Settings,
  ChevronsUpDown,
  Menu,
  LogOut,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

type Workspace = { id: string; name: string; slug: string };

type MembershipRow = {
  workspace_id: string;
  role: 'owner' | 'admin' | 'member';
  workspaces: Workspace | null;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const NAV = [
  { href: '/app/inbox', label: 'Inbox', icon: Inbox },
  { href: '/app/leads', label: 'Leads', icon: Users },
  { href: '/app/pipeline', label: 'Pipeline', icon: Workflow },
  { href: '/app/integrations', label: 'Integrations', icon: Plug },
  { href: '/app/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/app/settings', label: 'Settings', icon: Settings },
] as const;

export default function AppShell(props: { children: React.ReactNode; initialMemberships: MembershipRow[] }) {
  const pathname = usePathname();
  const router = useRouter();

  const memberships = props.initialMemberships;

  const workspaces = useMemo(() => {
    const out: Workspace[] = [];
    for (const m of memberships) {
      if (m.workspaces?.id && m.workspaces.name && m.workspaces.slug) out.push(m.workspaces);
    }
    return out;
  }, [memberships]);

  const [mobileOpen, setMobileOpen] = useState(false);

  // Workspace activo (por ahora: el primero; luego lo persistimos)
  const active = workspaces[0] ?? null;

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/auth');
  }

  const isOnboarding = pathname?.startsWith('/app/onboarding') ?? false;

  return (
    <div className="min-h-screen">
      {/* Fondo global elegante */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(900px_550px_at_15%_15%,rgba(99,102,241,0.16),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(900px_550px_at_85%_70%,rgba(16,185,129,0.12),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(700px_400px_at_50%_95%,rgba(255,255,255,0.06),transparent_60%)]" />
      </div>

      {/* Topbar móvil */}
      <div className="md:hidden sticky top-0 z-40 border-b border-white/10 bg-black/35 backdrop-blur-[10px]">
        <div className="container-default flex items-center justify-between py-3">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/85 hover:bg-white/10"
          >
            <span className="inline-flex items-center gap-2">
              <Menu className="h-4 w-4" />
              Menú
            </span>
          </button>

          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{active?.name ?? 'Kalue'}</p>
            <p className="text-[11px] text-white/55 truncate">{active?.slug ?? 'workspace'}</p>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[86%] max-w-[360px] card-glass border border-white/10 p-4">
            <SidebarContent
              activeWorkspace={active}
              workspaces={workspaces}
              pathname={pathname ?? ''}
              onNavigate={() => setMobileOpen(false)}
              onSignOut={signOut}
            />
          </div>
        </div>
      ) : null}

      {/* Desktop layout */}
      <div className="container-default grid grid-cols-1 md:grid-cols-[290px_1fr] gap-6 py-6">
        <aside className="hidden md:block">
          <div className="sticky top-6">
            <div className="card-glass border border-white/10 p-4 rounded-2xl">
              <SidebarContent
                activeWorkspace={active}
                workspaces={workspaces}
                pathname={pathname ?? ''}
                onNavigate={() => undefined}
                onSignOut={signOut}
              />
            </div>
          </div>
        </aside>

        <main className={cx(isOnboarding ? 'md:col-span-2' : '')}>{props.children}</main>
      </div>
    </div>
  );
}

function SidebarContent(props: {
  activeWorkspace: Workspace | null;
  workspaces: Workspace[];
  pathname: string;
  onNavigate: () => void;
  onSignOut: () => void | Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Brand + Workspace switch */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Kalue</p>
          <p className="text-[11px] text-white/55">Lead ops system</p>
        </div>

        <button
          type="button"
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
          title="Selector de workspace (v1: fijo al primero)"
        >
          <span className="inline-flex items-center gap-2">
            <ChevronsUpDown className="h-4 w-4" />
            {props.activeWorkspace?.slug ?? 'workspace'}
          </span>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1">
        {NAV.map((it) => {
          const active = props.pathname === it.href || props.pathname.startsWith(it.href + '/');
          const Icon = it.icon;

          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={props.onNavigate}
              className={cx(
                'group flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-sm transition',
                active
                  ? 'border-indigo-400/35 bg-indigo-500/12 text-indigo-100'
                  : 'border-white/10 bg-white/5 text-white/80 hover:bg-white/10'
              )}
            >
              <span
                className={cx(
                  'inline-flex h-9 w-9 items-center justify-center rounded-2xl border transition',
                  active
                    ? 'border-indigo-400/25 bg-indigo-500/10'
                    : 'border-white/10 bg-white/5 group-hover:bg-white/10'
                )}
              >
                <Icon className="h-4 w-4" />
              </span>

              <span className="min-w-0 truncate">{it.label}</span>

              {active ? (
                <span className="ml-auto h-2 w-2 rounded-full bg-indigo-300" />
              ) : (
                <span className="ml-auto h-2 w-2 rounded-full bg-white/20 opacity-0 group-hover:opacity-100" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
        <p className="font-medium text-white/85">Tip</p>
        <p className="mt-1">
          Este sidebar es “glass + glow”. Luego añadimos: selector real de workspace, notifs, y quick actions.
        </p>
      </div>

      <button
        type="button"
        onClick={() => void props.onSignOut()}
        className="mt-auto rounded-2xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
