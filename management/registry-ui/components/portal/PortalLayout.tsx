import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { Menu, X, LayoutDashboard, Package, MessageSquare, ShoppingCart, LogOut, ChevronDown, Globe, Gift } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { CustomerProvider, useCustomer, portalLogout } from '@/lib/portal-auth';
import { useLocale, type Locale } from '@/lib/locale';

function PortalLayoutInner({ children }: { children: React.ReactNode }) {
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
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
          {/* Logo + desktop nav */}
          <div className="flex items-center gap-8">
            <Link href="/portal/dashboard" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-brand">
                <Globe className="h-4 w-4 text-white" />
              </div>
              <span className="text-base font-bold tracking-tight">{t('brand')}</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                    isActive(href)
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="hidden md:flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
              {(['zh', 'en'] as Locale[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLocale(l)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                    locale === l
                      ? 'bg-background text-foreground shadow-sm'
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
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-all hover:bg-accent"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                    {(customer.nickname || customer.email || '?')[0].toUpperCase()}
                  </div>
                  <span className="max-w-[120px] truncate">{customer.nickname || customer.email}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute right-0 z-50 mt-1.5 w-44 rounded-xl border bg-popover p-1.5 shadow-lg animate-fade-in">
                      <div className="px-3 py-2 mb-1">
                        <p className="text-sm font-medium truncate">{customer.nickname || customer.email}</p>
                        {customer.nickname && <p className="text-xs text-muted-foreground truncate">{customer.email}</p>}
                      </div>
                      <div className="h-px bg-border mx-1 my-1" />
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
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
              className="md:hidden flex items-center justify-center h-9 w-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="border-t md:hidden animate-slide-up">
            <nav className="flex flex-col p-3 space-y-1">
              {navItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                    isActive(href)
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              ))}
              <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5 w-fit mx-3 mt-2">
                {(['zh', 'en'] as Locale[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLocale(l)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                      locale === l
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {l === 'zh' ? '中文' : 'EN'}
                  </button>
                ))}
              </div>
              {customer && (
                <>
                  <div className="h-px bg-border mx-1 my-2" />
                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <LogOut className="h-4 w-4" />
                    {t('logout')}
                  </button>
                </>
              )}
            </nav>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl p-4 md:p-6 lg:p-8">{children}</main>
    </div>
  );
}

export function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <CustomerProvider>
      <PortalLayoutInner>{children}</PortalLayoutInner>
    </CustomerProvider>
  );
}
