import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { LayoutDashboard, Server, Download, Users, ScrollText, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { useCurrentUser } from '@/lib/auth';
import { useLocale, type Locale } from '@/lib/locale';

export function Sidebar() {
  const router = useRouter();
  const { user } = useCurrentUser();
  const { locale, setLocale } = useLocale();
  const tAuth = useTranslations('auth');
  const tNav = useTranslations('nav');

  const baseNavItems = [
    { href: '/dashboard', label: tNav('dashboard'), icon: LayoutDashboard, perm: null },
    { href: '/nodes', label: tNav('nodes'), icon: Server, perm: null },
    { href: '/subscriptions', label: tNav('subscriptions'), icon: Download, perm: null },
  ];

  const adminNavItems = [
    { href: '/users', label: tNav('users'), icon: Users, perm: 'user:read' },
    { href: '/roles', label: tNav('roles'), icon: ShieldCheck, perm: 'role:read' },
    { href: '/audit-logs', label: tNav('auditLogs'), icon: ScrollText, perm: 'audit:read' },
  ];

  const navItems = [
    ...baseNavItems,
    ...adminNavItems.filter(({ perm }) => perm && user?.can(perm)),
  ];

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r bg-card">
      <div className="flex h-14 items-center px-4">
        <span className="text-base font-bold tracking-tight">{tAuth('hiveRegistry')}</span>
      </div>
      <Separator />
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ href, label, icon: Icon }) => {
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
              {label}
            </Link>
          );
        })}
      </nav>
      <Separator />
      <div className="flex items-center justify-center gap-1 p-3">
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
    </aside>
  );
}
