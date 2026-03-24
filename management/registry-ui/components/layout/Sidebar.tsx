import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { LayoutDashboard, Server, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { t } from '@/lib/i18n';

const navItems = [
  { href: '/dashboard', labelKey: 'dashboard' as const, icon: LayoutDashboard },
  { href: '/nodes', labelKey: 'nodes' as const, icon: Server },
  { href: '/subscriptions', labelKey: 'subscriptions' as const, icon: Download },
];

export function Sidebar() {
  const router = useRouter();

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r bg-card">
      <div className="flex h-14 items-center px-4">
        <span className="text-base font-bold tracking-tight">{t.hiveRegistry}</span>
      </div>
      <Separator />
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ href, labelKey, icon: Icon }) => {
          const isActive =
            router.pathname === href || router.pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t[labelKey]}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
