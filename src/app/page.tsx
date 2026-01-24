// src/app/page.tsx
import LoginClient from './LoginClient';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <div className="min-h-screen w-full px-4 py-10 text-white">
      <div className="mx-auto w-full max-w-[560px]">
        <LoginClient />
      </div>
    </div>
  );
}
