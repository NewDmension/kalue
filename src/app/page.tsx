// src/app/page.tsx
import LoginClient from './LoginClient';

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-black text-white">
      <LoginClient />
    </main>
  );
}
