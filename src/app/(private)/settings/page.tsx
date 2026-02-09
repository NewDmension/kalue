'use client';

import Link from 'next/link';

type SettingsCard = {
  title: string;
  description: string;
  href: string;
  tag: { label: string; className: string };
  footerLeft: string;
  footerCta: string;
};

const CARDS: SettingsCard[] = [
  {
    title: 'Workspaces',
    description: 'Crea, renombra y gestiona tus workspaces. Cambia el activo para toda la app.',
    href: '/settings/workspaces',
    tag: { label: 'Workspace', className: 'bg-indigo-500/20 text-indigo-200' },
    footerLeft: 'Listado + roles + acciones.',
    footerCta: 'Abrir workspaces →',
  },
  {
    title: 'Integrations',
    description: 'Conecta fuentes como Meta Lead Ads (y futuras). Estado de conexión y configuración.',
    href: '/integrations',
    tag: { label: 'Setup', className: 'bg-indigo-500/20 text-indigo-200' },
    footerLeft: 'Meta, GHL y más.',
    footerCta: 'Configurar →',
  },
  {
    title: 'Team & Permissions',
    description: 'Invitaciones, roles y permisos por workspace (más adelante).',
    href: '/settings',
    tag: { label: 'Soon', className: 'bg-white/10 text-white/70' },
    footerLeft: 'Owners, members, policies.',
    footerCta: 'Próximamente →',
  },
  {
    title: 'Billing',
    description: 'Plan, facturación, métodos de pago y límites (más adelante).',
    href: '/settings',
    tag: { label: 'Soon', className: 'bg-amber-500/15 text-amber-200' },
    footerLeft: 'Suscripción y recibos.',
    footerCta: 'Próximamente →',
  },
];

export default function SettingsPage() {
  return (
    <div className="container-default py-8 text-white">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-white/70 max-w-2xl">
          Preferencias del workspace, usuarios, permisos, integraciones y billing.
        </p>
      </div>

      {/* Grid mini-cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {CARDS.map((c) => (
          <Link key={c.title} href={c.href} className="group h-full">
            <div className="card-glass flex h-full flex-col p-5 transition-transform duration-150 hover:-translate-y-1 hover:border-indigo-400/70 border border-white/10 rounded-2xl">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">{c.title}</h2>
                  <p className="text-sm text-white/70">{c.description}</p>
                </div>

                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium border border-white/10 ${c.tag.className}`}
                >
                  {c.tag.label}
                </span>
              </div>

              <div className="mt-auto flex items-center justify-between pt-4 text-xs text-white/70">
                <p>{c.footerLeft}</p>
                <span className="text-indigo-300 group-hover:translate-x-1 transition-transform">
                  {c.footerCta}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
