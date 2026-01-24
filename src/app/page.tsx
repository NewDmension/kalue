import { Suspense } from 'react';
import RootAuthClient from './_components/RootAuthClient';

export default function HomePage() {
  return (
    <div className="min-h-screen w-full px-4 py-10 text-white flex items-center justify-center">
      <div className="w-full max-w-[560px]">
        <Suspense
          fallback={
            <div className="card-glass rounded-2xl border border-white/10 p-6">
              Cargando…
            </div>
          }
        >
          <RootAuthClient />
        </Suspense>
      </div>
    </div>
  );
}
