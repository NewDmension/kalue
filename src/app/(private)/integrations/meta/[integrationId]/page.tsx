'use client';

import { useMemo } from 'react';
import Link from 'next/link';

type PageProps = {
  params: {
    integrationId?: string;
  };
};

function isUuid(v: string): boolean {
  // UUID v1-v5 (simple y suficiente para UI)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export default function MetaIntegrationConfigPage({ params }: PageProps) {
  const integrationId = useMemo(() => {
    const raw = typeof params?.integrationId === 'string' ? params.integrationId.trim() : '';
    return raw.length > 0 ? raw : null;
  }, [params?.integrationId]);

  const valid = integrationId ? isUuid(integrationId) : false;

  return (
    <div className="container-default py-8 text-white">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Meta · Configurar integración</h1>
        <p className="text-sm text-white/70 max-w-2xl">
          Aquí irá el asistente OAuth + selección de Page/Form + mapping de campos.
        </p>
      </div>

      {!valid ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">
          <div className="font-semibold">ID inválida</div>
          <div className="mt-1 text-xs text-white/70 break-all">
            Valor recibido: <span className="text-white/90">{integrationId ?? '(vacío)'}</span>
          </div>
          <div className="mt-3">
            <Link
              href="/integrations"
              className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
            >
              ← Volver a Integraciones
            </Link>
          </div>
        </div>
      ) : (
        <div className="card-glass rounded-2xl border border-white/10 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-white/60">Integration ID</p>
              <p className="mt-1 text-sm font-semibold text-white break-all">{integrationId}</p>
            </div>

            <span className="shrink-0 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">
              Setup
            </span>
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold">1) OAuth</p>
              <p className="mt-1 text-xs text-white/70">Conectar la cuenta de Meta del usuario.</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold">2) Page / Form</p>
              <p className="mt-1 text-xs text-white/70">Elegir página y formularios de Lead Ads.</p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold">3) Mapping</p>
              <p className="mt-1 text-xs text-white/70">Mapear campos → tu modelo de lead.</p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className={cx(
                'inline-flex items-center rounded-xl border px-4 py-2 text-sm transition',
                'border-indigo-400/30 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/15'
              )}
            >
              Conectar con Meta (próximo)
            </button>

            <Link
              href="/integrations"
              className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
            >
              Volver
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
