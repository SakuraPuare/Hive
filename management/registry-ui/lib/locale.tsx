import React, { createContext, useContext, useEffect, useState } from 'react';

export type Locale = 'zh' | 'en';

const LOCALE_KEY = 'hive_locale';
const DEFAULT_LOCALE: Locale = 'zh';

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (l: Locale) => void;
}>({ locale: DEFAULT_LOCALE, setLocale: () => {} });

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // 初始用默认语言，mount 后再从 localStorage 同步，保证 SSR hydration 一致
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCALE_KEY) as Locale | null;
      if (stored === 'zh' || stored === 'en') setLocaleState(stored);
    } catch {}
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    try { localStorage.setItem(LOCALE_KEY, l); } catch {}
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
