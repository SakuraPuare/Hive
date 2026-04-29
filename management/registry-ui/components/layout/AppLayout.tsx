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
    <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm">
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
        {(user.username || '?')[0].toUpperCase()}
      </div>
      <span className="font-medium">{user.username}</span>
    </div>
  );
}

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const tCommon = useTranslations('common');

  async function handleLogout() {
    try {
      await sessionApi(AdminService.adminLogout());
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <CurrentUserProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-end gap-3 border-b bg-background/80 backdrop-blur-lg px-6">
            <UserBadge />
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              {tCommon('logout')}
            </Button>
          </header>
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </CurrentUserProvider>
  );
}
