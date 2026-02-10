// src/components/app/AppShell.tsx
'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  Home,
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

// ✅ Ajusta el path si tu componente está en otro sitio
import LanguageSwitcher from '@/components/LanguageSwitcher';

type Workspace = { id: string; name: string; slug: string };

type MembershipRow = {
  workspace_id: string;
  role: 'owner' | 'admin' | 'member';
  workspaces: Workspace | null;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const ACTIVE_WORKSPACE_KEY = 'kalue.activeWorkspaceId';

function safeGetActiveWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

function safeSetActiveWorkspaceId(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
  } catch {
    // ignore
  }
}

/**
 * ✅ Rutas nuevas (sin /app)
 * ✅ Dashboard/Onboarding antes de Inbox
 */
const NAV = [
  { href: '/onboarding', key: 'dashboard', icon: Home },
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

  // ✅ Cerrar drawer al navegar (evita “sidebar duplicado”)
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // ✅ Cerrar drawer al pasar a desktop (>= md)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (mql.matches) setMobileOpen(false);
    };

    onChange();

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }

    // Fallback older Safari
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  // Workspace context (persistido)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    const stored = safeGetActiveWorkspaceId();
    if (stored) setActiveWorkspaceId(stored);
  }, []);

  useEffect(() => {
    if (workspaces.length === 0) {
      if (activeWorkspaceId !== null) setActiveWorkspaceId(null);
      return;
    }

    const exists =
      activeWorkspaceId !== null ? workspaces.some((w) => w.id === activeWorkspaceId) : false;

    if (!activeWorkspaceId || !exists) {
      const fallback = workspaces[0]!.id;
      setActiveWorkspaceId(fallback);
      safeSetActiveWorkspaceId(fallback);
    }
  }, [workspaces, activeWorkspaceId]);

  const active = useMemo(() => {
    if (workspaces.length === 0) return null;
    if (!activeWorkspaceId) return workspaces[0] ?? null;
    return workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0] ?? null;
  }, [workspaces, activeWorkspaceId]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <div className="min-h-screen w-full">
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
            <p className="text-[11px] text-white/55 truncate">
              {active?.slug ?? tNav('workspace')}
            </p>
          </div>

          {/* ✅ Idioma + Logout */}
          <div className="flex items-center gap-2">
            <div className="rounded-xl border border-white/15 bg-white/5 px-2 py-1">
              <LanguageSwitcher />
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

      {/* Desktop layout: sidebar con ALTURA NATURAL + full width horizontal */}
      <div className="hidden md:block w-full px-6 py-6">
        <div className="flex w-full items-start gap-6">
          <aside className="shrink-0">
            <div className="card-glass border border-white/10 p-4 rounded-2xl">
              <SidebarContent
                activeWorkspace={active}
                pathname={pathname ?? ''}
                onNavigate={() => undefined}
                onSignOut={signOut}
              />
            </div>
          </aside>

          <main className="min-w-0 flex-1">{props.children}</main>
        </div>
      </div>

      {/* Mobile main (sin sidebar fijo) */}
      <div className="md:hidden w-full px-4 py-4">
        <main className="min-w-0">{props.children}</main>
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
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{tCommon('brand')}</p>
          <p className="text-[11px] text-white/55">{tCommon('tagline')}</p>
        </div>

        <div className="flex items-center gap-2">
          {/* ✅ Selector idioma en sidebar */}
          <div className="rounded-xl border border-white/15 bg-white/5 px-2 py-1">
            <LanguageSwitcher />
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
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map((it) => {
          const isActive = props.pathname === it.href || props.pathname.startsWith(it.href + '/');
          const Icon = it.icon;
          const label = tNav(it.key as NavKey);

          return (
            <Link
              key={it.href}
              href={it.href}
              onClick={props.onNavigate}
              className={cx(
                'group flex items-center gap-3 rounded-xl px-2 py-2 text-sm transition',
                isActive ? 'text-white bg-white/5' : 'text-white/80 hover:text-white hover:bg-white/5'
              )}
            >
              <span
                className={cx(
                  'inline-flex h-9 w-9 items-center justify-center rounded-xl border transition',
                  isActive
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
                  isActive ? 'bg-indigo-300 opacity-100' : 'bg-white/20 opacity-0 group-hover:opacity-100'
                )}
              />
            </Link>
          );
        })}
      </nav>

      <div className="mt-2">
        <button
          type="button"
          onClick={() => void props.onSignOut()}
          className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10"
        >
          {tNav('signOut')}
        </button>
      </div>
    </div>
  );
}
