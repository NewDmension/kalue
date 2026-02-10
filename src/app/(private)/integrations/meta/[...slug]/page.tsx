'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useParams, usePathname } from 'next/navigation';
import MetaIntegrationConfigClient from '../MetaIntegrationConfigClient';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function firstSegment(v: string | string[] | undefined): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

export default function MetaCatchAllPage() {
  const pathname = usePathname();
  const params = useParams();

  const rawSlug = params?.slug as string | string[] | undefined;
  const integrationId = useMemo(() => firstSegment(rawSlug).trim(), [rawSlug]);

  const ok = integrationId.length > 0 && isUuid(integrationId);

  if (!ok) {
    return (
      <div className="p-6 text-white">
        <div className="card-glass rounded-2xl border border-white/10 p-6">
          <h1 className="text-lg font-semibold text-white">ID inválida</h1>
          <p className="mt-2 text-sm text-white/70">
            Valor recibido: <span className="font-mono text-white/90">{integrationId || '(vacío)'}</span>
          </p>

          <div className="mt-4">
            <Link
              href="/integrations"
              className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
            >
              Volver a integraciones
            </Link>
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold text-white/90">Debug</p>
            <div className="mt-2 space-y-2 text-xs text-white/70">
              <div>
                <span className="text-white/80">pathname:</span>{' '}
                <span className="font-mono text-white/90">{pathname}</span>
              </div>
              <div>
                <span className="text-white/80">useParams:</span>
              </div>
              <pre className="overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
                {JSON.stringify(params ?? null, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <MetaIntegrationConfigClient integrationId={integrationId} />;
}
