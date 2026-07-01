import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { Menu, X, LayoutDashboard, Package, MessageSquare, ShoppingCart, LogOut, ChevronDown, Globe, Gift, Megaphone, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { CustomerProvider, useCustomer, portalLogout } from '@/lib/portal-auth';
import { LocaleToggle } from '@/components/portal/LocaleToggle';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useOptionalToast } from '@/components/ui/toast';

const initialOf = (name?: string | null, email?: string | null) =>
  (name || email || '?').charAt(0).toUpperCase();

function PortalLayoutInner({ children }: { children: React.ReactNode }) {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { customer, loading } = useCustomer();
  const toast = useOptionalToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const mobilePanelRef = useRef<HTMLDivElement>(null);

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

  // Mobile menu: Esc to close, body scroll lock, move focus into panel on open.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    mobilePanelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen]);

  // Close the mobile menu after a client-side navigation completes.
  useEffect(() => {
    const close = () => setMobileOpen(false);
    router.events?.on('routeChangeComplete', close);
    return () => router.events?.off('routeChangeComplete', close);
  }, [router.events]);

  async function confirmLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await portalLogout();
      setConfirmOpen(false);
      router.replace('/portal/login');
    } catch {
      toast?.error(t('logoutFailed'));
    } finally {
      setIsLoggingOut(false);
    }
  }

  const displayName = customer?.nickname || customer?.email || '';

  return (
    <div className="min-h-screen bg-background">
      {/* Skip to main content — first focusable element */}
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-md-primary focus:px-4 focus:py-2 focus:text-sm focus:font-500 focus:text-md-on-primary focus:elevation-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
      >
        {t('skipToContent')}
      </a>

      {/* Top navbar */}
      <header className="sticky top-0 z-50 border-b border-md-outline-variant bg-md-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
          {/* Logo + desktop nav */}
          <div className="flex items-center gap-8">
            <Link href="/portal/dashboard" className="state-layer flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-md-primary text-md-on-primary elevation-1">
                <Globe className="h-[18px] w-[18px]" aria-hidden="true" />
              </div>
              <span className="font-display text-base font-600 tracking-tight text-foreground">{t('brand')}</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1" aria-label={t('brand')}>
              {navItems.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={isActive(href) ? 'page' : undefined}
                  className={cn(
                    'state-layer flex items-center gap-2 rounded-full px-4 py-2 text-sm font-500 transition-colors',
                    isActive(href)
                      ? 'bg-md-secondary-container text-md-on-secondary-container'
                      : 'text-md-on-surface-variant hover:text-foreground'
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <div className="hidden md:block">
              <LocaleToggle groupLabel={t('language')} />
            </div>

            {/* User dropdown (desktop) */}
            {loading ? (
              <div className="hidden md:flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3" aria-hidden="true">
                <div className="h-8 w-8 animate-pulse rounded-full bg-md-surface-container-high" />
                <div className="h-3.5 w-20 animate-pulse rounded-full bg-md-surface-container-high" />
              </div>
            ) : customer ? (
              <div className="hidden md:block">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t('userMenu')}
                      className="state-layer flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm font-500 text-md-on-surface-variant transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-md-surface"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-md-primary-container text-md-on-primary-container text-xs font-600">
                        {initialOf(customer.nickname, customer.email)}
                      </span>
                      <span className="max-w-[120px] truncate">{displayName}</span>
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="normal-case">
                      <span className="block truncate text-sm font-500 text-foreground">{displayName}</span>
                      {customer.nickname && customer.email && (
                        <span className="block truncate text-xs font-400 text-md-on-surface-variant mt-0.5">{customer.email}</span>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/portal/account">
                        <User className="h-[18px] w-[18px]" aria-hidden="true" />
                        {t('navAccount')}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
                      <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
                      {t('logout')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : null}

            {/* Mobile hamburger */}
            <button
              type="button"
              className="state-layer md:hidden flex items-center justify-center h-12 w-12 rounded-full text-md-on-surface-variant transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-md-surface"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? t('closeMenu') : t('openMenu')}
              aria-expanded={mobileOpen}
              aria-controls="portal-mobile-nav"
            >
              {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <>
            <div
              aria-hidden="true"
              className="fixed inset-x-0 bottom-0 top-16 z-40 bg-md-scrim/30 md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <div
              id="portal-mobile-nav"
              ref={mobilePanelRef}
              className="relative z-50 border-t border-md-outline-variant bg-md-surface md:hidden animate-slide-up"
            >
              <nav className="flex flex-col p-3 space-y-1" aria-label={t('brand')}>
                {navItems.map(({ href, label, icon: Icon }, i) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    aria-current={isActive(href) ? 'page' : undefined}
                    className={cn(
                      'state-layer flex min-h-12 items-center gap-3 rounded-full px-4 text-sm font-500 transition-colors animate-slide-up',
                      isActive(href)
                        ? 'bg-md-secondary-container text-md-on-secondary-container'
                        : 'text-md-on-surface-variant hover:text-foreground'
                    )}
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    {label}
                  </Link>
                ))}
                <div className="mx-3 mt-3 w-fit">
                  <LocaleToggle groupLabel={t('language')} size="lg" />
                </div>
                {customer && (
                  <>
                    <div className="h-px bg-md-outline-variant mx-1 my-2" />
                    <button
                      type="button"
                      onClick={() => { setMobileOpen(false); setConfirmOpen(true); }}
                      className="state-layer flex min-h-12 items-center gap-3 rounded-full px-4 text-sm font-500 text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-md-surface"
                    >
                      <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
                      {t('logout')}
                    </button>
                  </>
                )}
              </nav>
            </div>
          </>
        )}
      </header>

      <main id="portal-main" tabIndex={-1} className="mx-auto max-w-6xl p-4 md:p-6 lg:p-8 focus:outline-none">{children}</main>

      {/* Logout confirmation */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!isLoggingOut) setConfirmOpen(o); }}>
        <DialogContent role="alertdialog" showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('confirmLogoutTitle')}</DialogTitle>
            <DialogDescription>{t('confirmLogoutDesc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="lg" disabled={isLoggingOut}>{tCommon('cancel')}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="lg"
              onClick={confirmLogout}
              loading={isLoggingOut}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? t('loggingOut') : t('logout')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
