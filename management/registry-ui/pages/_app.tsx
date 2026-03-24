import React from 'react';
import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { ThemeProvider } from 'next-themes';
import { AppLayout } from '@/components/layout/AppLayout';
import '@/styles/globals.css';

const NO_LAYOUT_PATHS = ['/', '/login'];

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const useLayout = !NO_LAYOUT_PATHS.includes(router.pathname);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      {useLayout ? (
        <AppLayout>
          <Component {...pageProps} />
        </AppLayout>
      ) : (
        <Component {...pageProps} />
      )}
    </ThemeProvider>
  );
}
