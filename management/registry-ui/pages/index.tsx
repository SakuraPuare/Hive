import React, { useEffect, useState } from 'react';
import { getHealth } from '@/lib/api';

export default function Home() {
  const [status, setStatus] = useState('checking');

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
      <p className="text-muted-foreground">Checking auth…</p>
    </div>
  );
}

