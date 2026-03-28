/// <reference types="vitest/globals" />
import '@testing-library/jest-dom/vitest';

// Mock next/router
const mockRouter = {
  pathname: '/',
  query: {},
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn().mockResolvedValue(undefined),
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  isReady: true,
  asPath: '/',
  route: '/',
  basePath: '',
  locale: undefined,
  locales: undefined,
  defaultLocale: undefined,
  isFallback: false,
  isLocaleDomain: false,
  isPreview: false,
};

vi.mock('next/router', () => ({
  useRouter: () => mockRouter,
  __mockRouter: mockRouter,
}));

// Mock next/link as a simple anchor
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => {
    // If children is a string or React element, wrap in <a>
    return <a href={href} {...props}>{children}</a>;
  },
}));

// Mock next-intl: return the key as the translation
// Cache t functions per namespace to avoid infinite re-render loops
// (components use t in useCallback deps)
const tCache = new Map<string, (key: string, params?: Record<string, any>) => string>();

function getT(ns: string) {
  if (!tCache.has(ns)) {
    tCache.set(ns, (key: string, params?: Record<string, any>) => {
      let result = `${ns}.${key}`;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          result = result.replace(`{${k}}`, String(v));
        });
      }
      return result;
    });
  }
  return tCache.get(ns)!;
}

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => getT(ns),
  NextIntlClientProvider: ({ children }: any) => children,
}));

// Mock next-themes
vi.mock('next-themes', () => ({
  ThemeProvider: ({ children }: any) => children,
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

// Mock ThemeToggle
vi.mock('@/components/layout/ThemeToggle', () => ({
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

// Mock locale
vi.mock('@/lib/locale', () => ({
  LocaleProvider: ({ children }: any) => children,
  useLocale: () => ({ locale: 'zh' as const, setLocale: vi.fn() }),
}));

// Expose mockRouter for per-test manipulation
export { mockRouter };
