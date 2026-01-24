// src/app/page.tsx
export default function HomePage() {
  return (
    <main className="min-h-screen w-full px-6 py-10 text-white">
      <div className="card-glass rounded-2xl border border-white/10 p-8">
        <h1 className="text-3xl font-semibold">Kalue — OK</h1>
        <p className="mt-2 text-white/70">
          Si ves esto, la ruta <code className="text-white/85">/</code> está funcionando en Vercel.
        </p>

        <div className="mt-6 grid gap-3 text-sm text-white/70">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="font-medium text-white/85">Debug</p>
            <p className="mt-1 text-white/60">
              Página renderizada desde <code className="text-white/85">src/app/page.tsx</code>
            </p>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="font-medium text-white/85">Siguiente paso</p>
            <p className="mt-1 text-white/60">
              Cuando esto se vea, volvemos a poner el login.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
