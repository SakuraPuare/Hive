import React, { useMemo } from 'react';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { ThemeProvider } from 'next-themes';
import { NextIntlClientProvider } from 'next-intl';
import { AppLayout } from '@/components/layout/AppLayout';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { LocaleProvider, useLocale, type Locale } from '@/lib/locale';
import '@/styles/globals.css';
import zhMessages from '../messages/zh.json';
import enMessages from '../messages/en.json';

// 同步加载所有语言包，避免 SSR 阶段 MISSING_MESSAGE 警告
const allMessages: Record<Locale, Record<string, unknown>> = {
  zh: zhMessages,
  en: enMessages,
};

const NO_LAYOUT_PATHS = ['/', '/login'];
const PORTAL_NO_LAYOUT_PATHS = ['/portal/login', '/portal/register'];

function IntlWrapper({ children }: { children: React.ReactNode }) {
  const { locale } = useLocale();
  const messages = useMemo(() => allMessages[locale], [locale]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const isNoLayout = NO_LAYOUT_PATHS.includes(router.pathname);
  const isPortal = router.pathname.startsWith('/portal');
  const isPortalNoLayout = PORTAL_NO_LAYOUT_PATHS.includes(router.pathname);

  let content: React.ReactNode;
  if (isNoLayout || isPortalNoLayout) {
    content = <Component {...pageProps} />;
  } else if (isPortal) {
    content = <PortalLayout><Component {...pageProps} /></PortalLayout>;
  } else {
    content = <AppLayout><Component {...pageProps} /></AppLayout>;
  }

  return (
    <LocaleProvider>
      <IntlWrapper>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {content}
        </ThemeProvider>
      </IntlWrapper>
    </LocaleProvider>
  );
}
