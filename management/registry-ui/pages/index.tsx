import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';

export default function Home() {
  const tAuth = useTranslations('auth');
  const router = useRouter();
  const [stalled, setStalled] = useState(false);

  // 站点首页面向顾客：默认进入公开门户落地页。
  // 管理员入口在落地页页脚 → /login。
  useEffect(() => {
    // SPA 导航而非整页刷新，且不污染 history。
    router.replace('/portal');
    // 兜底：若跳转因 CSP/错误卡住，3s 后给出可见出口。
    const timer = window.setTimeout(() => setStalled(true), 3000);
    return () => window.clearTimeout(timer);
  }, [router]);

  return (
    <>
      <Head>
        <title>{tAuth('redirectingTitle')}</title>
      </Head>
      <main
        className="flex min-h-screen items-center justify-center bg-background"
        aria-busy="true"
      >
        <h1 className="sr-only">{tAuth('redirectingToPortal')}</h1>
        {/* M3 surface container — centered loading card */}
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-md-surface-container-low border px-10 py-10 animate-fade-in elevation-1">
          {/* M3 circular progress indicator (CSS-only) */}
          <span
            className="block size-10 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin"
            style={{ animationDuration: '800ms', animationTimingFunction: 'var(--ease-standard)' }}
            aria-hidden="true"
          />
          <p
            className="font-display text-base font-500 text-muted-foreground"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {tAuth('redirectingToPortal')}
          </p>
          {stalled && (
            <Link
              href="/portal"
              className="text-sm font-500 text-md-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 rounded-md"
            >
              {tAuth('redirectStalled')}
            </Link>
          )}
        </div>
      </main>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- raw anchor required: Link needs JS, this is the no-JS fallback */}
        <a href="/portal">{tAuth('continueToPortal')}</a>
      </noscript>
    </>
  );
}
