// src/app/(private)/integraciones/meta/[integrationId]/page.tsx
'use client';

import { useMemo } from 'react';
import Link from 'next/link';

type PageProps = {
  params: { integrationId: string };
};

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function MetaIntegrationConfigPage({ params }: PageProps) {
  const integrationId = params.integrationId;

  const invalid = useMemo(() => !isUuid(integrationId), [integrationId]);

  return (
    <div className="container-default py-8 text-white">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Meta · Configurar integración</h1>
          <p className="mt-1 text-sm text-white/70">
            Aquí irá el asistente OAuth + selección de Page/Form + mapping de campos.
          </p>
        </div>

        <Link
          href="/integraciones"
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
        >
          ← Volver
        </Link>
      </div>

      {invalid ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">
          ID inválida: {integrationId}
        </div>
      ) : (
        <div className="card-glass rounded-2xl border border-white/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">Integration ID</p>
              <p className="mt-1 text-xs text-white/60 break-all">{integrationId}</p>
            </div>

            <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-200">
              Draft
            </span>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm text-white/90 font-semibold">Siguientes pasos (placeholder)</p>
            <ul className="mt-2 list-disc pl-5 text-sm text-white/70 space-y-1">
              <li>Botón “Conectar con Meta (OAuth)”</li>
              <li>Seleccionar Business / Page</li>
              <li>Seleccionar Lead Form</li>
              <li>Guardar tokens/metadata en la integración</li>
              <li>Mapping de campos → nuestro esquema de lead</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
