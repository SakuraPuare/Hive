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
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">{tAuth('checkingAuth')}</p>
    </div>
  );
}
