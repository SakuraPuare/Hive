import React, { useEffect } from 'react';
import { getHealth } from '@/lib/api';
import { useTranslations } from 'next-intl';

export default function Home() {
  const tAuth = useTranslations('auth');

  useEffect(() => {
    (async () => {
      const h = await getHealth();
      if (h) window.location.href = '/dashboard';
      else window.location.href = '/login';
    })();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">{tAuth('checkingAuth')}</p>
    </div>
  );
}
