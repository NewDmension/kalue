// File: src/app/login/page.tsx
import LoginClient from '../LoginClient';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-white text-black">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl border border-slate-200 bg-slate-50" aria-hidden="true" />
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900">Kalue</p>
              <p className="text-xs text-slate-600">Login</p>
            </div>
          </div>

          <nav className="flex items-center gap-2">
            <a
              href="/"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Home
            </a>
            <a
              href="/signup"
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              Crear cuenta
            </a>
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[560px] px-4 py-10">
        {/* Conservas tu UI actual sin romper nada */}
        <div className="text-white">
          <LoginClient />
        </div>
      </div>
    </main>
  );
}
