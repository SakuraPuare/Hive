import React from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { LogOut, Menu, User, Settings } from 'lucide-react';
import { Sidebar, SidebarDrawer } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { AdminService } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { CurrentUserProvider, useCurrentUser } from '@/lib/auth';
import { useTranslations } from 'next-intl';

async function performLogout() {
  try {
    await sessionApi(AdminService.adminLogout());
  } finally {
    window.location.href = '/login';
  }
}

/** Account dropdown: profile / settings / logout. Logout opens a confirm dialog. */
function UserBadge() {
  const { user } = useCurrentUser();
  const tCommon = useTranslations('common');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);

  if (!user) return null;

  const onConfirmLogout = () => {
    if (loggingOut) return;
    setLoggingOut(true);
    void performLogout();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="state-layer flex items-center gap-2.5 rounded-full bg-md-surface-container-high pl-1 pr-3.5 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-md-primary-container text-md-on-primary-container text-xs font-700 font-display">
              {(user.username || '?')[0].toUpperCase()}
            </span>
            <span className="font-500 text-foreground">{user.username}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          <DropdownMenuLabel className="normal-case tracking-normal text-foreground">
            {user.username}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/account">
              <User aria-hidden="true" />
              {tCommon('profile')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings aria-hidden="true" />
              {tCommon('settings')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
            <LogOut aria-hidden="true" />
            {tCommon('logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={(o) => !loggingOut && setConfirmOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tCommon('confirmLogoutTitle')}</DialogTitle>
            <DialogDescription>{tCommon('confirmLogoutMessage')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={loggingOut}
              onClick={() => setConfirmOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button variant="destructive" disabled={loggingOut} onClick={onConfirmLogout}>
              <LogOut aria-hidden="true" />
              {loggingOut ? tCommon('loggingOut') : tCommon('logout')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const router = useRouter();
  const [navOpen, setNavOpen] = React.useState(false);

  // Close the mobile drawer on any route change (covers browser back/forward
  // and programmatic navigation, not just in-drawer link clicks).
  React.useEffect(() => {
    const close = () => setNavOpen(false);
    router.events.on('routeChangeComplete', close);
    return () => router.events.off('routeChangeComplete', close);
  }, [router.events]);

  return (
    <CurrentUserProvider>
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-full bg-md-primary px-4 py-2 text-sm font-medium text-md-on-primary focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {tCommon('skipToContent')}
      </a>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <SidebarDrawer
          open={navOpen}
          onOpenChange={setNavOpen}
          title={tNav('mainNavigation')}
          id="mobile-nav-drawer"
        />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-md-outline-variant glass px-4 sm:px-6">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setNavOpen(true)}
              aria-label={tNav('openNavigation')}
              aria-expanded={navOpen}
              aria-controls="mobile-nav-drawer"
              className="text-md-on-surface-variant hover:text-foreground lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
            <div className="ml-auto flex items-center gap-3">
              <UserBadge />
              <ThemeToggle />
            </div>
          </header>
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 overflow-y-auto px-6 py-8 outline-none sm:px-8 lg:px-10"
          >
            {children}
          </main>
        </div>
      </div>
    </CurrentUserProvider>
  );
}
