import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { Menu, X, LayoutDashboard, Package, MessageSquare, ShoppingCart, LogOut, ChevronDown, Globe, Gift, Megaphone, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { CustomerProvider, useCustomer, portalLogout } from '@/lib/portal-auth';
import { useLocale, type Locale } from '@/lib/locale';

async function handleLogout() {
  await portalLogout();
  window.location.href = '/portal/login';
}

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
    { href: '/portal/referral', label: t('navReferral'), icon: Gift },
    { href: '/portal/announcements', label: t('navAnnouncements'), icon: Megaphone },
  ];

  const isActive = (href: string) =>
    router.pathname === href || router.pathname.startsWith(href + '/');

  return (
    <div className="min-h-screen bg-background">
      {/* Top navbar */}
      <header className="sticky top-0 z-50 border-b border-md-outline-variant bg-md-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
          {/* Logo + desktop nav */}
          <div className="flex items-center gap-8">
            <Link href="/portal/dashboard" className="state-layer flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-md-primary text-md-on-primary elevation-1">
                <Globe className="h-[18px] w-[18px]" />
              </div>
              <span className="font-display text-base font-600 tracking-tight text-foreground">{t('brand')}</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'state-layer flex items-center gap-2 rounded-full px-4 py-2 text-sm font-500 transition-colors',
                    isActive(href)
                      ? 'bg-md-secondary-container text-md-on-secondary-container'
                      : 'text-md-on-surface-variant hover:text-foreground'
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="hidden md:flex items-center gap-0.5 rounded-full bg-md-surface-container-high p-1">
              {(['zh', 'en'] as Locale[]).map((l) => (
                <button type="button"
                  key={l}
                  onClick={() => setLocale(l)}
                  className={cn(
                    'state-layer rounded-full px-3 py-1 text-xs font-500 transition-colors',
                    locale === l
                      ? 'bg-md-primary text-md-on-primary'
                      : 'text-md-on-surface-variant hover:text-foreground'
                  )}
                >
                  {l === 'zh' ? '中文' : 'EN'}
                </button>
              ))}
            </div>

            {/* User dropdown (desktop) */}
            {customer && (
              <div className="relative hidden md:block">
                <button type="button"
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="state-layer flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm font-500 text-md-on-surface-variant transition-colors hover:text-foreground"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-md-primary-container text-md-on-primary-container text-xs font-600">
                    {(customer.nickname || customer.email || '?')[0].toUpperCase()}
                  </div>
                  <span className="max-w-[120px] truncate">{customer.nickname || customer.email}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', userMenuOpen && 'rotate-180')} />
                </button>
                {userMenuOpen && (
                  <>
                    <button type="button" aria-label="关闭菜单" className="fixed inset-0 z-40 cursor-default" onClick={() => setUserMenuOpen(false)} />
                    <div className="absolute right-0 z-50 mt-2 w-52 rounded-2xl border border-md-outline-variant bg-popover p-1.5 elevation-2 animate-scale-in origin-top-right">
                      <div className="px-3 py-2.5 mb-1">
                        <p className="text-sm font-500 truncate text-foreground">{customer.nickname || customer.email}</p>
                        {customer.nickname && <p className="text-xs text-md-on-surface-variant truncate mt-0.5">{customer.email}</p>}
                      </div>
                      <div className="h-px bg-md-outline-variant mx-1 my-1" />
                      <Link
                        href="/portal/account"
                        onClick={() => setUserMenuOpen(false)}
                        className="state-layer flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-500 text-md-on-surface-variant transition-colors hover:text-foreground"
                      >
                        <User className="h-[18px] w-[18px]" />
                        {t('navAccount')}
                      </Link>
                      <button type="button"
                        onClick={handleLogout}
                        className="state-layer flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-500 text-destructive transition-colors"
                      >
                        <LogOut className="h-[18px] w-[18px]" />
                        {t('logout')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Mobile hamburger */}
            <button type="button"
              className="state-layer md:hidden flex items-center justify-center h-10 w-10 rounded-full text-md-on-surface-variant transition-colors hover:text-foreground"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="border-t border-md-outline-variant bg-md-surface md:hidden animate-slide-up">
            <nav className="flex flex-col p-3 space-y-1">
              {navItems.map(({ href, label, icon: Icon }, i) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'state-layer flex items-center gap-3 rounded-full px-4 py-3 text-sm font-500 transition-colors animate-slide-up',
                    isActive(href)
                      ? 'bg-md-secondary-container text-md-on-secondary-container'
                      : 'text-md-on-surface-variant hover:text-foreground'
                  )}
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <Icon className="h-[18px] w-[18px]" />
                  {label}
                </Link>
              ))}
              <div className="flex items-center gap-0.5 rounded-full bg-md-surface-container-high p-1 w-fit mx-3 mt-3">
                {(['zh', 'en'] as Locale[]).map((l) => (
                  <button type="button"
                    key={l}
                    onClick={() => setLocale(l)}
                    className={cn(
                      'state-layer rounded-full px-3 py-1 text-xs font-500 transition-colors',
                      locale === l
                        ? 'bg-md-primary text-md-on-primary'
                        : 'text-md-on-surface-variant hover:text-foreground'
                    )}
                  >
                    {l === 'zh' ? '中文' : 'EN'}
                  </button>
                ))}
              </div>
              {customer && (
                <>
                  <div className="h-px bg-md-outline-variant mx-1 my-2" />
                  <button type="button"
                    onClick={handleLogout}
                    className="state-layer flex items-center gap-3 rounded-full px-4 py-3 text-sm font-500 text-destructive"
                  >
                    <LogOut className="h-[18px] w-[18px]" />
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
