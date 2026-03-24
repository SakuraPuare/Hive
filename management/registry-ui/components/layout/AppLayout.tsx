import React from 'react';
import { LogOut } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { Button } from '@/components/ui/button';
import { adminLogout } from '@/lib/api';
import { useTranslations } from 'next-intl';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const tCommon = useTranslations('common');

  async function handleLogout() {
    try {
      await adminLogout();
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-end gap-2 border-b px-4">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            {tCommon('logout')}
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
