import LoginClient from '@/components/LoginClient';

export default function HomePage() {
  return (
    <div className="min-h-screen w-full px-4 py-10 text-white flex items-center justify-center">
      <div className="w-full max-w-[560px]">
        <LoginClient />
      </div>
    </div>
  );
}
