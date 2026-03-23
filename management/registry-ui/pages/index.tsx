import React, { useEffect, useState } from 'react';
import { getHealth } from '../lib/api';

export default function Home() {
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    (async () => {
      const h = await getHealth();
      setStatus(h ? 'ok' : 'unauth');
      if (h) window.location.href = '/nodes';
      else window.location.href = '/login';
    })();
  }, []);

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, color: '#333' }}>
      Checking auth... {status}
    </div>
  );
}

