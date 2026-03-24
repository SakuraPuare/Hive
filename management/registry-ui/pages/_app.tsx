import React, { useMemo } from 'react';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { ThemeProvider } from 'next-themes';
import { NextIntlClientProvider } from 'next-intl';
import { AppLayout } from '@/components/layout/AppLayout';
import { LocaleProvider, useLocale, type Locale } from '@/lib/locale';
import '@/styles/globals.css';

// 同步加载所有语言包，避免 SSR 阶段 MISSING_MESSAGE 警告
const allMessages: Record<Locale, Record<string, unknown>> = {
  zh: require('../messages/zh.json'),
  en: require('../messages/en.json'),
};

const NO_LAYOUT_PATHS = ['/', '/login'];

function IntlWrapper({ children }: { children: React.ReactNode }) {
  const { locale } = useLocale();
  const messages = useMemo(() => allMessages[locale], [locale]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const useLayout = !NO_LAYOUT_PATHS.includes(router.pathname);

  return (
    <LocaleProvider>
      <IntlWrapper>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {useLayout ? (
            <AppLayout>
              <Component {...pageProps} />
            </AppLayout>
          ) : (
            <Component {...pageProps} />
          )}
        </ThemeProvider>
      </IntlWrapper>
    </LocaleProvider>
  );
}
