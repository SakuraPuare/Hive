import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { LayoutDashboard, Server, Download, Route, Package, Users, ScrollText, ShieldCheck, Activity, UserCheck, ShoppingCart, Tag, MessageSquare, Megaphone, Globe } from 'lucide-react';
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
    { href: '/node-status', label: tNav('nodeStatus'), icon: Activity, perm: null },
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

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r bg-card">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg gradient-brand">
          <Globe className="h-4 w-4 text-white" />
        </div>
        <span className="text-base font-bold tracking-tight">{tAuth('hiveRegistry')}</span>
      </div>
      <Separator />
      <nav aria-label="主导航" className="flex-1 overflow-y-auto p-3 space-y-1">
        {mainItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            router.pathname === href || router.pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
              {label}
            </Link>
          );
        })}

        {adminItems.length > 0 && (
          <>
            <div className="pt-3 pb-1 px-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {tNav('admin') || 'Admin'}
              </span>
            </div>
            {adminItems.map(({ href, label, icon: Icon }) => {
              const isActive =
                router.pathname === href || router.pathname.startsWith(href + '/');
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                  {label}
                </Link>
              );
            })}
          </>
        )}
      </nav>
      <Separator />
      <div className="flex items-center justify-center gap-0.5 p-3">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {(['zh', 'en'] as Locale[]).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              aria-label={l === 'zh' ? '切换到中文' : 'Switch to English'}
              aria-pressed={locale === l}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-medium transition-all',
                locale === l
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
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
