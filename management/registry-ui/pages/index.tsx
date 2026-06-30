import React, { useEffect } from 'react';
import { useTranslations } from 'next-intl';

export default function Home() {
  const tAuth = useTranslations('auth');

  // 站点首页面向顾客：默认进入公开门户落地页。
  // 管理员入口在落地页页脚 → /login。
  useEffect(() => {
    window.location.href = '/portal';
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      {/* M3 surface container — centered loading card */}
      <div className="flex flex-col items-center gap-6 rounded-2xl bg-md-surface-container-low border px-10 py-10 animate-fade-in elevation-1">
        {/* M3 circular progress indicator (CSS-only) */}
        <span
          className="block size-10 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin"
          style={{ animationDuration: '800ms', animationTimingFunction: 'var(--ease-standard)' }}
          aria-hidden="true"
        />
        <p className="font-display text-base font-500 text-muted-foreground">
          {tAuth('checkingAuth')}
        </p>
      </div>
    </div>
  );
}
