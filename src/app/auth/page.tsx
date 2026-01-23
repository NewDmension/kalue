import { Suspense } from 'react';
import AuthClient from './AuthClient';

export default function AuthPage() {
  return (
    <div className="container-default py-10 text-white">
      <div className="mx-auto w-full max-w-[560px]">
        <Suspense fallback={<div className="card-glass rounded-2xl border border-white/10 p-6">Cargando…</div>}>
          <AuthClient />
        </Suspense>
      </div>
    </div>
  );
}
