'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Locale = 'es' | 'en';

function setLocaleCookie(locale: Locale) {
  // 1 año
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `NEXT_LOCALE=${locale}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export default function LanguageSwitcher() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const current: Locale =
    typeof document !== 'undefined' && document.cookie.includes('NEXT_LOCALE=en') ? 'en' : 'es';

  function changeTo(locale: Locale) {
    setLocaleCookie(locale);
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="inline-flex rounded-xl border border-white/15 bg-white/5 p-1">
      <button
        type="button"
        onClick={() => changeTo('es')}
        disabled={isPending}
        className={[
          'px-3 py-1.5 text-xs rounded-lg transition',
          current === 'es' ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white',
          isPending ? 'opacity-60' : '',
        ].join(' ')}
      >
        ES
      </button>
      <button
        type="button"
        onClick={() => changeTo('en')}
        disabled={isPending}
        className={[
          'px-3 py-1.5 text-xs rounded-lg transition',
          current === 'en' ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white',
          isPending ? 'opacity-60' : '',
        ].join(' ')}
      >
        EN
      </button>
    </div>
  );
}
