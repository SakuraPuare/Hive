import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { Menu, X, LayoutDashboard, Package, MessageSquare, ShoppingCart, LogOut, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { useCustomer, portalLogout } from '@/lib/portal-auth';
import { useLocale, type Locale } from '@/lib/locale';

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('portal');
  const router = useRouter();
  const { customer } = useCustomer();
  const { locale, setLocale } = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const navItems = [
    { href: '/portal/dashboard', label: t('navDashboard'), icon: LayoutDashboard },
    { href: '/portal/plans', label: t('navPlans'), icon: Package },
    { href: '/portal/orders', label: t('navOrders'), icon: ShoppingCart },
    { href: '/portal/tickets', label: t('navTickets'), icon: MessageSquare },
  ];

  async function handleLogout() {
    await portalLogout();
    window.location.href = '/portal/login';
  }

  const isActive = (href: string) =>
    router.pathname === href || router.pathname.startsWith(href + '/');

  return (
    <div className="min-h-screen bg-background">
      {/* Top navbar */}
      <header className="sticky top-0 z-50 border-b bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          {/* Logo + desktop nav */}
          <div className="flex items-center gap-6">
            <Link href="/portal/dashboard" className="text-base font-bold tracking-tight">
              {t('brand')}
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive(href)
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Right side: theme, lang, user */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="hidden md:flex items-center gap-1">
              {(['zh', 'en'] as Locale[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLocale(l)}
                  className={cn(
                    'rounded px-2 py-1 text-xs font-medium transition-colors',
                    locale === l
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {l === 'zh' ? '中文' : 'EN'}
                </button>
              ))}
            </div>

            {/* User dropdown (desktop) */}
            {customer && (
              <div className="relative hidden md:block">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {customer.nickname || customer.email}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute right-0 z-50 mt-1 w-36 rounded-md border bg-popover p-1 shadow-md">
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      >
                        <LogOut className="h-4 w-4" />
                        {t('logout')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Mobile hamburger */}
            <button
              className="md:hidden rounded-md p-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="border-t md:hidden">
            <nav className="flex flex-col p-3 space-y-1">
              {navItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive(href)
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
              <div className="flex items-center gap-1 px-3 py-2">
                {(['zh', 'en'] as Locale[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLocale(l)}
                    className={cn(
                      'rounded px-2 py-1 text-xs font-medium transition-colors',
                      locale === l
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {l === 'zh' ? '中文' : 'EN'}
                  </button>
                ))}
              </div>
              {customer && (
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  {t('logout')}
                </button>
              )}
            </nav>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl p-4 md:p-6">{children}</main>
    </div>
  );
}
