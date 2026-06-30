import React from 'react';
import { LogOut } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { Button } from '@/components/ui/button';
import { AdminService } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { CurrentUserProvider, useCurrentUser } from '@/lib/auth';
import { useTranslations } from 'next-intl';

function UserBadge() {
  const { user } = useCurrentUser();
  if (!user) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-full bg-md-surface-container-high pl-1 pr-3.5 py-1 text-sm">
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-md-primary-container text-md-on-primary-container text-xs font-700 font-display">
        {(user.username || '?')[0].toUpperCase()}
      </div>
      <span className="font-500 text-foreground">{user.username}</span>
    </div>
  );
}

interface AppLayoutProps {
  children: React.ReactNode;
}

async function handleLogout() {
  try {
    await sessionApi(AdminService.adminLogout());
  } finally {
    window.location.href = '/login';
  }
}

export function AppLayout({ children }: AppLayoutProps) {
  const tCommon = useTranslations('common');

  return (
    <CurrentUserProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-end gap-3 border-b border-md-outline-variant glass px-6">
            <UserBadge />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="state-layer rounded-full gap-2 text-md-on-surface-variant hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              {tCommon('logout')}
            </Button>
          </header>
          <main className="flex-1 overflow-y-auto px-6 py-8 sm:px-8 lg:px-10">{children}</main>
        </div>
      </div>
    </CurrentUserProvider>
  );
}
