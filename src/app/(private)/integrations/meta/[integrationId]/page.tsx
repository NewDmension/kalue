import Link from 'next/link';

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  params: { integrationId?: string };
  searchParams?: SearchParams;
};

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function first(v: string | string[] | undefined): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return '';
}

export default function MetaIntegrationConfigPage({ params, searchParams }: PageProps) {
  const fromParams = (params?.integrationId ?? '').trim();

  // Fallbacks por si el Link te está enviando por query
  const fromQuery =
    first(searchParams?.integrationId).trim() ||
    first(searchParams?.id).trim() ||
    first(searchParams?.integration_id).trim();

  const integrationId = fromParams || fromQuery;

  const ok = integrationId.length > 0 && isUuid(integrationId);

  if (!ok) {
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

          {/* DEBUG BOX (clave) */}
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-sm font-semibold text-white/90">Debug</p>
            <div className="mt-3 space-y-2 text-xs text-white/70">
              <div>
                <span className="text-white/80">params.integrationId:</span>{' '}
                <span className="font-mono text-white/90">{fromParams || '(vacío)'}</span>
              </div>
              <div>
                <span className="text-white/80">query.integrationId:</span>{' '}
                <span className="font-mono text-white/90">{first(searchParams?.integrationId) || '(vacío)'}</span>
              </div>
              <div>
                <span className="text-white/80">query.id:</span>{' '}
                <span className="font-mono text-white/90">{first(searchParams?.id) || '(vacío)'}</span>
              </div>
              <div>
                <span className="text-white/80">query.integration_id:</span>{' '}
                <span className="font-mono text-white/90">{first(searchParams?.integration_id) || '(vacío)'}</span>
              </div>
              <div className="pt-2">
                <span className="text-white/80">RAW params:</span>
                <pre className="mt-1 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
                  {JSON.stringify(params ?? null, null, 2)}
                </pre>
              </div>
              <div className="pt-2">
                <span className="text-white/80">RAW searchParams:</span>
                <pre className="mt-1 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
                  {JSON.stringify(searchParams ?? null, null, 2)}
                </pre>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/60">
            Si aquí ves el UUID en <span className="font-mono">searchParams</span> pero no en{" "}
            <span className="font-mono">params</span>, tu Link/redirect está enviando el id como query en vez de segmento.
          </div>
        </div>
      </div>
    );
  }

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

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm font-semibold text-white/90">Asistente (placeholder)</p>
          <p className="mt-2 text-sm text-white/70">
            Paso 1: OAuth Meta · Paso 2: Selección Page/Form · Paso 3: Mapping
          </p>
        </div>
      </div>
    </div>
  );
}
