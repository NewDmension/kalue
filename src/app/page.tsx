// src/app/page.tsx
import { Suspense } from 'react';
import LoginClient from './LoginClient';

export default function HomePage() {
  return (
    <div className="min-h-screen w-full px-4 py-10 text-white flex items-center justify-center">
      <div className="w-full max-w-[560px]">
        <Suspense
          fallback={
            <div className="card-glass rounded-2xl border border-white/10 p-6 text-white/70">
              Cargando…
            </div>
          }
        >
          <LoginClient />
        </Suspense>
      </div>
    </div>
  );
}
