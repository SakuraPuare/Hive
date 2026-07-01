import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { LayoutDashboard, Server, Download, Route, Package, Users, ScrollText, ShieldCheck, Activity, UserCheck, ShoppingCart, Tag, MessageSquare, Megaphone, Globe, Waypoints } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/lib/auth';

/** First path segment, e.g. "/nodes/[id]" -> "nodes". Used for robust active matching. */
function firstSegment(path: string): string {
  return (path.split('?')[0].split('#')[0].split('/')[1] || '').toLowerCase();
}

interface SidebarContentProps {
  /** Called after a nav link is activated — used by the mobile drawer to close itself. */
  onNavigate?: () => void;
}

/**
 * The shared sidebar body: brand + permission-gated nav.
 * Rendered both inside the static desktop rail (<Sidebar>) and the mobile
 * drawer (<SidebarDrawer>) so active state and markup stay in sync.
 * (Locale switching lives in the top bar, see AppLayout.)
 */
export function SidebarContent({ onNavigate }: SidebarContentProps) {
  const router = useRouter();
  const { user, loading } = useCurrentUser();
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
    const isActive = firstSegment(router.pathname) === firstSegment(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={onNavigate}
        title={label}
        aria-current={isActive ? 'page' : undefined}
        style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
        className={cn(
          'state-layer animate-slide-up group relative flex min-h-12 items-center gap-3 rounded-full px-4 py-3 text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card',
          isActive
            ? 'bg-md-secondary-container text-md-on-secondary-container'
            : 'text-md-on-surface-variant hover:text-md-on-surface'
        )}
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </Link>
    );
  };

  // Fixed-height skeleton rows while the current user resolves, so the nav
  // doesn't first paint perm:null items then reflow once permissions load.
  const renderSkeleton = () => (
    <div aria-hidden="true" className="space-y-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex min-h-12 items-center gap-3 rounded-full px-4 py-3">
          <div className="h-5 w-5 shrink-0 animate-pulse rounded-md bg-md-surface-container-highest" />
          <div
            className="h-3.5 animate-pulse rounded-full bg-md-surface-container-highest"
            style={{ width: `${55 + ((i * 7) % 30)}%` }}
          />
        </div>
      ))}
    </div>
  );

  return (
    <>
      <div className="flex h-16 shrink-0 items-center px-3">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          aria-label={tAuth('hiveRegistry')}
          className="state-layer flex items-center gap-3 rounded-full py-1.5 pl-1.5 pr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-md-primary text-md-on-primary elevation-1">
            <Globe className="h-[18px] w-[18px]" aria-hidden="true" />
          </div>
          <span className="font-display text-base font-600 tracking-tight text-foreground">
            {tAuth('hiveRegistry')}
          </span>
        </Link>
      </div>
      <nav aria-label={tNav('mainNavigation')} className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {loading ? (
          renderSkeleton()
        ) : (
          <>
            {mainItems.map(renderNavItem)}

            {adminItems.length > 0 && (
              <>
                <div className="px-4 pt-5 pb-2">
                  <span className="text-[11px] font-600 uppercase tracking-wider text-md-on-surface-variant/70">
                    {tNav('admin')}
                  </span>
                </div>
                {adminItems.map((item, i) => renderNavItem(item, mainItems.length + i))}
              </>
            )}
          </>
        )}
      </nav>
    </>
  );
}

/** Static navigation rail. Visible at lg+ only; below lg use <SidebarDrawer>. */
export function Sidebar() {
  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r bg-card lg:flex">
      <SidebarContent />
    </aside>
  );
}

interface SidebarDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name + visually-hidden title for the drawer dialog. */
  title: string;
  /** id wired to the hamburger trigger's aria-controls. */
  id?: string;
}

/**
 * Off-canvas navigation drawer for < lg viewports. Built on the Radix Dialog
 * primitive, which provides focus trapping, Esc-to-close, scroll lock, and
 * focus restoration to the trigger out of the box. AppLayout owns `open`.
 */
export function SidebarDrawer({ open, onOpenChange, title, id }: SidebarDrawerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-md-scrim/50 backdrop-blur-[1px] lg:hidden" />
        <DialogPrimitive.Content
          id={id}
          aria-label={title}
          className="fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] outline-none lg:hidden"
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <aside className="animate-slide-up flex h-full flex-col border-r bg-card elevation-3">
            <SidebarContent onNavigate={() => onOpenChange(false)} />
          </aside>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
