import React, { useEffect, useState } from 'react';
import { getHealth } from '@/lib/api';
import { t } from '@/lib/i18n';

export default function Home() {
  const [, setStatus] = useState('checking');

  useEffect(() => {
    (async () => {
      const h = await getHealth();
      setStatus(h ? 'ok' : 'unauth');
      if (h) window.location.href = '/dashboard';
      else window.location.href = '/login';
    })();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">{t.checkingAuth}</p>
    </div>
  );
}
