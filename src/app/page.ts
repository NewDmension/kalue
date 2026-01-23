import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="card-glass p-6">
      <h1 className="text-2xl font-semibold text-white">Kalue</h1>
      <p className="mt-2 text-sm text-white/70">
        Base del proyecto creada. Siguiente: auth + workspaces + RLS.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/auth" className="btn-primary">
          Ir a Auth (test)
        </Link>
        <a
          className="btn-ghost"
          href="https://supabase.com"
          target="_blank"
          rel="noreferrer"
        >
          Supabase
        </a>
      </div>
    </div>
  );
}
