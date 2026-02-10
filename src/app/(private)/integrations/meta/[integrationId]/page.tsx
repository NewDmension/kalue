import Link from 'next/link';

export default function Page({ params }: { params: { integrationId: string } }) {
  return (
    <div className="p-6 text-white">
      <div className="card-glass rounded-2xl border border-white/10 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">✅ ROUTE REAL meta/[integrationId]</h1>
            <p className="mt-2 text-sm text-white/70">
              integrationId: <span className="font-mono text-white/90">{params.integrationId}</span>
            </p>
          </div>
          <Link
            href="/integrations"
            className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200 hover:bg-indigo-500/15"
          >
            Volver
          </Link>
        </div>
      </div>
    </div>
  );
}
