/// <reference types="vitest/globals" />
import '@testing-library/jest-dom/vitest';
import * as React from 'react';

// JSDOM lacks the pointer/scroll/observer APIs Radix (DropdownMenu, Select,
// Dialog) probes when opening. Stub them so portalled menus can render in tests.
if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

// Mock next/font/google — return a stub font object so module-load font
// wiring in _app.tsx (Roboto_Flex / Lexend) doesn't crash under jsdom.
vi.mock('next/font/google', () => ({
  Roboto_Flex: () => ({ variable: '--font-roboto-flex', className: 'font-roboto-flex', style: { fontFamily: 'Roboto Flex' } }),
  Lexend: () => ({ variable: '--font-lexend', className: 'font-lexend', style: { fontFamily: 'Lexend' } }),
}));

// Mock the toast primitive: pages call useToast() directly but tests render
// pages without the _app ToastProvider wrapper. Provide a no-op API + a
// pass-through Provider so toast calls don't throw and assertions can spy.
const mockToast = {
  success: vi.fn(() => 0),
  error: vi.fn(() => 0),
  info: vi.fn(() => 0),
  show: vi.fn(() => 0),
  dismiss: vi.fn(),
};
vi.mock('@/components/ui/toast', () => ({
  useToast: () => mockToast,
  useOptionalToast: () => mockToast,
  ToastProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  __mockToast: mockToast,
}));

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

// Mock next/link as a simple anchor. forwardRef so Radix `asChild`/Slot
// (e.g. DropdownMenuItem asChild > Link) can attach its ref without erroring.
const MockLink = React.forwardRef<HTMLAnchorElement, any>(({ children, href, ...props }, ref) => (
  <a ref={ref} href={href} {...props}>{children}</a>
));
MockLink.displayName = 'MockLink';

vi.mock('next/link', () => ({
  default: MockLink,
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
  // Pages migrated to Material 3 now call useLocale() to drive Intl date/number
  // formatting. Return a Chinese locale so currency renders with a bare ¥
  // (an English locale would prefix "CN¥"). Additive export — existing tests
  // that don't use useLocale are unaffected.
  useLocale: () => 'zh-CN',
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
