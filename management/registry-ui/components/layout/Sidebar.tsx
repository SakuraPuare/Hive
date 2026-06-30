import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { LayoutDashboard, Server, Download, Route, Package, Users, ScrollText, ShieldCheck, Activity, UserCheck, ShoppingCart, Tag, MessageSquare, Megaphone, Globe, Waypoints } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
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
    { href: '/node-status', label: tNav('nodeStatus'), icon: Activity, perm: null },
    { href: '/gateway', label: tNav('gateway'), icon: Waypoints, perm: 'node:read' },
    { href: '/subscriptions', label: tNav('subscriptions'), icon: Download, perm: null },
    { href: '/lines', label: tNav('lines'), icon: Route, perm: 'line:read' },
    { href: '/plans', label: tNav('plans'), icon: Package, perm: 'subscription:read' },
    { href: '/customers', label: tNav('customers'), icon: UserCheck, perm: 'customer:read' },
  ];

  const adminNavItems = [
    { href: '/orders', label: tNav('orders'), icon: ShoppingCart, perm: 'order:read' },
    { href: '/promo-codes', label: tNav('promoCodes'), icon: Tag, perm: 'order:write' },
    { href: '/tickets', label: tNav('tickets'), icon: MessageSquare, perm: 'ticket:read' },
    { href: '/announcements', label: tNav('announcements'), icon: Megaphone, perm: 'announcement:write' },
    { href: '/users', label: tNav('users'), icon: Users, perm: 'user:read' },
    { href: '/roles', label: tNav('roles'), icon: ShieldCheck, perm: 'role:read' },
    { href: '/audit-logs', label: tNav('auditLogs'), icon: ScrollText, perm: 'audit:read' },
  ];

  const mainItems = baseNavItems.filter(({ perm }) => !perm || user?.can(perm));
  const adminItems = adminNavItems.filter(({ perm }) => perm && user?.can(perm));

  const renderNavItem = (
    { href, label, icon: Icon }: { href: string; label: string; icon: typeof LayoutDashboard },
    index: number,
  ) => {
    const isActive =
      router.pathname === href || router.pathname.startsWith(href + '/');
    return (
      <Link
        key={href}
        href={href}
        aria-current={isActive ? 'page' : undefined}
        style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
        className={cn(
          'state-layer animate-slide-up group relative flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          isActive
            ? 'bg-md-secondary-container text-md-on-secondary-container'
            : 'text-md-on-surface-variant hover:text-md-on-surface'
        )}
      >
        <Icon className="h-5 w-5 shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
    );
  };

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r bg-card">
      <div className="flex h-16 items-center gap-3 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-md-primary text-md-on-primary elevation-1">
          <Globe className="h-[18px] w-[18px]" />
        </div>
        <span className="font-display text-base font-600 tracking-tight text-foreground">
          {tAuth('hiveRegistry')}
        </span>
      </div>
      <nav aria-label="主导航" className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {mainItems.map(renderNavItem)}

        {adminItems.length > 0 && (
          <>
            <div className="px-4 pt-5 pb-2">
              <span className="text-[11px] font-600 uppercase tracking-wider text-md-on-surface-variant/70">
                {tNav('admin') || 'Admin'}
              </span>
            </div>
            {adminItems.map((item, i) => renderNavItem(item, mainItems.length + i))}
          </>
        )}
      </nav>
      <div className="p-3">
        <div className="flex items-center gap-1 rounded-full bg-md-surface-container-high p-1">
          {(['zh', 'en'] as Locale[]).map((l) => (
            <button type="button"
              key={l}
              onClick={() => setLocale(l)}
              aria-label={l === 'zh' ? '切换到中文' : 'Switch to English'}
              aria-pressed={locale === l}
              className={cn(
                'state-layer flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1 focus-visible:ring-offset-card',
                locale === l
                  ? 'bg-md-secondary-container text-md-on-secondary-container'
                  : 'text-md-on-surface-variant hover:text-md-on-surface'
              )}
            >
              {l === 'zh' ? '中文' : 'EN'}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
