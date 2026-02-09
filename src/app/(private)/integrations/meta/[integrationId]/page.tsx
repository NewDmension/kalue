import Link from 'next/link';

type PageProps = {
  params: {
    integrationId: string;
  };
};

function isUuid(v: string): boolean {
  // UUID v1–v5
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function MetaIntegrationConfigPage({ params }: PageProps) {
  const integrationIdRaw = typeof params?.integrationId === 'string' ? params.integrationId : '';
  const integrationId = integrationIdRaw.trim();

  if (!integrationId || !isUuid(integrationId)) {
    return (
      <div className="p-6">
        <div className="card-glass rounded-2xl border border-white/10 p-6">
          <h1 className="text-lg font-semibold text-white">ID inválida</h1>
          <p className="mt-2 text-sm text-white/70">
            Valor recibido: <span className="font-mono text-white/90">{integrationId || '(vacío)'}</span>
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/integrations"
              className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
            >
              Volver a integraciones
            </Link>
          </div>

          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            <p className="mb-2 font-semibold text-white/80">Checklist rápido</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>La carpeta es exactamente <span className="font-mono">[integrationId]</span> (mismo casing).</li>
              <li>El link usa <span className="font-mono">/integrations/meta/${'{id}'}</span> (inglés).</li>
              <li>No hay redirects a <span className="font-mono">/integraciones/...</span> en navbar/middleware.</li>
              <li>No tipar <span className="font-mono">params</span> como Promise.</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Aquí irá tu asistente real: OAuth + Pages/Forms + mapping.
  return (
    <div className="p-6">
      <div className="card-glass rounded-2xl border border-white/10 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white">Integración Meta</h1>
            <p className="mt-1 text-sm text-white/70">
              Integration ID: <span className="font-mono text-white/90">{integrationId}</span>
            </p>
          </div>

          <Link
            href="/integrations"
            className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
          >
            Volver
          </Link>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-2">
            <h2 className="text-sm font-semibold text-white/90">Asistente de configuración</h2>
            <p className="mt-2 text-sm text-white/70">
              Paso 1: Conectar con Meta (OAuth).<br />
              Paso 2: Seleccionar Page + Lead Form.<br />
              Paso 3: Mapping de campos a tu modelo.
            </p>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
              >
                Conectar con Meta (OAuth)
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-sm font-semibold text-white/90">Estado</h2>
            <p className="mt-2 text-sm text-white/70">draft</p>
            <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/60">
              Este panel luego mostrará: tokens, page_id, form_id, último sync, errores.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
