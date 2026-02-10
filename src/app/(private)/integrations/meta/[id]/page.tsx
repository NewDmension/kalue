import Link from 'next/link';
import MetaIntegrationConfigClient from './MetaIntegrationConfigClient';

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function Page({ params }: { params: { id?: string } }) {
  const integrationId = (params.id ?? '').trim();

  if (!integrationId || !isUuid(integrationId)) {
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
        </div>
      </div>
    );
  }

  return <MetaIntegrationConfigClient integrationId={integrationId} />;
}
