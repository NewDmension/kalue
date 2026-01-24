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
import { useTranslations } from 'next-intl';

type Workspace = { id: string; name: string; slug: string };

type MembershipRow = {
  workspace_id: string;
  role: 'owner' | 'admin' | 'member';
  workspaces: Workspace | null;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * ✅ Rutas nuevas (sin /app)
 */
const NAV = [
  { href: '/inbox', key: 'inbox', icon: Inbox },
  { href: '/leads', key: 'leads', icon: Users },
  { href: '/pipeline', key: 'pipeline', icon: Workflow },
  { href: '/integrations', key: 'integrations', icon: Plug },
  { href: '/campaigns', key: 'campaigns', icon: Megaphone },
  { href: '/settings', key: 'settings', icon: Settings },
] as const;

type NavKey = (typeof NAV)[number]['key'];

export default function AppShell(props: {
  children: React.ReactNode;
  initialMemberships: MembershipRow[];
}) {
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');

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

  const active = workspaces[0] ?? null;

  async function signOut() {
    await supabase.auth.signOut();
    // ✅ Login es HOME
    router.push('/');
    router.refresh();
  }

  // ✅ Onboarding ya no vive en /app/onboarding
  const isOnboarding = pathname?.startsWith('/onboarding') ?? false;

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
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/85 hover:bg-white/10"
          >
            <span className="inline-flex items-center gap-2">
              <Menu className="h-4 w-4" />
              {tNav('menu')}
            </span>
          </button>

          <div className="min-w-0 text-center">
            <p className="text-sm font-semibold text-white truncate">
              {active?.name ?? tCommon('brand')}
            </p>
            <p className="text-[11px] text-white/55 truncate">{active?.slug ?? tNav('workspace')}</p>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
            aria-label={tNav('signOut')}
            title={tNav('signOut')}
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
              pathname={pathname ?? ''}
              onNavigate={() => setMobileOpen(false)}
              onSignOut={signOut}
            />
          </div>
        </div>
      ) : null}

      {/* Desktop layout: FULL WIDTH */}
      <div className="w-full px-6 py-6">
        <div
          className={cx(
            'grid w-full gap-6',
            isOnboarding ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-[240px_1fr]'
          )}
        >
          {!isOnboarding ? (
            <aside className="hidden md:block">
              <div className="sticky top-6">
                <div className="card-glass border border-white/10 p-4 rounded-2xl">
                  <SidebarContent
                    activeWorkspace={active}
                    pathname={pathname ?? ''}
                    onNavigate={() => undefined}
                    onSignOut={signOut}
                  />
                </div>
              </div>
            </aside>
          ) : null}

          <main className="min-w-0">{props.children}</main>
        </div>
      </div>
    </div>
  );
}

function SidebarContent(props: {
  activeWorkspace: Workspace | null;
  pathname: string;
  onNavigate: () => void;
  onSignOut: () => void | Promise<void>;
}) {
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');

  return (
    <div className="flex flex-col gap-4">
      {/* Brand + Workspace switch */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{tCommon('brand')}</p>
          <p className="text-[11px] text-white/55">{tCommon('tagline')}</p>
        </div>

        <button
          type="button"
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
          title={tNav('workspaceSelectorTitle')}
        >
          <span className="inline-flex items-center gap-2">
            <ChevronsUpDown className="h-4 w-4" />
            {props.activeWorkspace?.slug ?? tNav('workspace')}
          </span>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1">
        {NAV.map((it) => {
          const active = props.pathname === it.href || props.pathname.startsWith(it.href + '/');
          const Icon = it.icon;
          const label = tNav(it.key as NavKey);

          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={props.onNavigate}
              className={cx(
                'group flex items-center gap-3 rounded-xl px-2 py-2 text-sm transition',
                active ? 'text-white' : 'text-white/80 hover:text-white',
                active ? 'bg-white/5' : 'hover:bg-white/5'
              )}
            >
              <span
                className={cx(
                  'inline-flex h-9 w-9 items-center justify-center rounded-xl border transition',
                  active
                    ? 'border-indigo-400/25 bg-indigo-500/10'
                    : 'border-white/10 bg-white/5 group-hover:bg-white/10'
                )}
              >
                <Icon className="h-4 w-4" />
              </span>

              <span className="min-w-0 truncate">{label}</span>

              <span
                className={cx(
                  'ml-auto h-2 w-2 rounded-full transition',
                  active ? 'bg-indigo-300 opacity-100' : 'bg-white/20 opacity-0 group-hover:opacity-100'
                )}
              />
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => void props.onSignOut()}
        className="mt-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10"
      >
        {tNav('signOut')}
      </button>
    </div>
  );
}
