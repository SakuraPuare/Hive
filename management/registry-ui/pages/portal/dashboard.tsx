import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import DOMPurify from 'dompurify';
import { useCustomer } from '@/lib/portal-auth';
import type { CustomerSubscription } from '@/lib/portal-auth';

type SubWithPlan = CustomerSubscription & { plan_name?: string };
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useClipboard } from '@/lib/use-clipboard';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import {
  Copy, Check, Package, MessageSquare, Megaphone,
  Zap, Clock, Shield, Gift, AlertTriangle, Info,
  AlertCircle, RefreshCw, X, LayoutDashboard,
} from 'lucide-react';
import { PortalPublicService } from '@/src/generated/client';

function trafficGB(bytes: number) {
  return (bytes / (1024 ** 3)).toFixed(2);
}

function SubscriptionCard({ sub, index, onCopied }: { sub: SubWithPlan; index: number; onCopied?: () => void }) {
  const t = useTranslations('portal');
  const toast = useToast();
  const { copied: copiedClash, copy: copyClash } = useClipboard();
  const { copied: copiedVless, copy: copyVless } = useClipboard();

  const isExpired = new Date(sub.expires_at ?? '') < new Date();
  const usedGB = trafficGB(sub.traffic_used ?? 0);
  const totalGB = sub.traffic_limit === 0 ? t('unlimited') : trafficGB(sub.traffic_limit ?? 0);
  const pct = (sub.traffic_limit ?? 0) > 0 ? Math.min(100, ((sub.traffic_used ?? 0) / (sub.traffic_limit ?? 1)) * 100) : 0;
  const pctRounded = Math.round(pct);

  const msPerDay = 1000 * 60 * 60 * 24;
  const diffDays = Math.ceil((new Date(sub.expires_at ?? '').getTime() - Date.now()) / msPerDay);
  const daysLeft = Math.max(0, diffDays);
  const expiredDays = Math.max(0, -diffDays);

  // Subscription links are Next.js routes (/c/...), not backend API paths,
  // so we use window.location.origin directly — apiUrl() would prepend /api.
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const clashLink = `${origin}/c/${sub.token}`;
  const vlessLink = `${origin}/c/${sub.token}/vless`;

  const handleCopyClash = useCallback(async () => {
    const ok = await copyClash(clashLink);
    if (ok) onCopied?.();
    else toast.error(t('copyFailed'));
  }, [copyClash, clashLink, toast, t, onCopied]);

  const handleCopyVless = useCallback(async () => {
    const ok = await copyVless(vlessLink);
    if (ok) onCopied?.();
    else toast.error(t('copyFailed'));
  }, [copyVless, vlessLink, toast, t, onCopied]);

  // Traffic bar color: use M3 semantic roles
  const barColor = pct > 80
    ? 'bg-md-error'
    : pct > 50
    ? 'bg-[hsl(43_96%_50%)]'
    : 'bg-md-primary';

  // Stat for the remaining-days slot: distinguish expired / expires-today / N days.
  const daysValue = isExpired ? expiredDays : daysLeft;
  const daysLabel = isExpired
    ? t('expired')
    : daysLeft === 0
    ? t('expiresToday')
    : t('daysRemaining');

  // Stagger only for the first 4 cards to avoid excessive delay on large lists.
  const delay = Math.min(index, 3) * 80;

  return (
    <Card
      className="overflow-hidden rounded-xl border bg-card animate-slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Top accent strip */}
      <div className={`h-1 w-full ${isExpired ? 'bg-md-error' : 'bg-md-primary'}`} aria-hidden="true" />

      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-display text-base font-600 text-foreground">
            {sub.plan_name ?? `${t('planName')} #${sub.plan_id}`}
          </CardTitle>
          {isExpired ? (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500
              bg-md-error-container text-md-on-error-container">
              <span className="size-1.5 rounded-full bg-md-error" aria-hidden="true" />
              {t('expired')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500
              bg-md-tertiary-container text-md-on-tertiary-container">
              <span className="size-1.5 rounded-full bg-md-tertiary" aria-hidden="true" />
              {t('active')}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 px-5 pb-5">
        {/* Stats row — tonal container surface */}
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-md-surface-container p-4">
          <div className="text-center">
            <Clock className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" aria-hidden="true" />
            <p className="font-display text-xl font-700 text-foreground">
              {daysValue}
            </p>
            <p className="text-xs text-muted-foreground">{daysLabel}</p>
          </div>
          <div className="text-center">
            <Shield className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" aria-hidden="true" />
            <p className="font-display text-xl font-700 text-foreground">
              {sub.device_limit}
            </p>
            <p className="text-xs text-muted-foreground">{t('devices')}</p>
          </div>
          <div className="text-center">
            <Zap className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" aria-hidden="true" />
            <p className="font-display text-xl font-700 text-foreground">
              {sub.traffic_limit === 0 ? '∞' : totalGB}
            </p>
            <p className="text-xs text-muted-foreground">{t('gb')}</p>
          </div>
        </div>

        {/* Traffic progress */}
        {(sub.traffic_limit ?? 0) > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('trafficUsage')}</span>
              <span className="font-500 text-foreground">{usedGB} / {totalGB} GB</span>
            </div>
            <div
              className="h-2 rounded-full bg-md-surface-container-high overflow-hidden"
              role="progressbar"
              aria-label={t('trafficUsage')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pctRounded}
              aria-valuetext={`${usedGB} / ${totalGB} GB (${pctRounded}%)`}
            >
              <div
                className={`h-full rounded-full transition-all duration-500 motion-reduce:transition-none ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {pct >= 100 && (
              <p className="text-xs text-md-error">{t('trafficExhausted')}</p>
            )}
          </div>
        )}

        {/* Copy link buttons */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-12 gap-1.5 text-sm font-500"
            onClick={handleCopyClash}
            aria-label={t('copyClashAria')}
          >
            {copiedClash
              ? <Check className="h-4 w-4 text-md-tertiary" aria-hidden="true" />
              : <Copy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            }
            {copiedClash ? t('copied') : t('copyClash')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-12 gap-1.5 text-sm font-500"
            onClick={handleCopyVless}
            aria-label={t('copyVlessAria')}
          >
            {copiedVless
              ? <Check className="h-4 w-4 text-md-tertiary" aria-hidden="true" />
              : <Copy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            }
            {copiedVless ? t('copied') : t('copyVless')}
          </Button>
        </div>

      </CardContent>
    </Card>
  );
}

interface PortalAnnouncement {
  id: number;
  title: string;
  content: string;
  level: string;
  pinned: boolean;
}

// M3-compliant banner styles — no raw blue/red/yellow palette
const BANNER_STYLES: Record<string, { wrapper: string; icon: React.ReactNode }> = {
  critical: {
    wrapper: 'border-md-error-container bg-md-error-container/40 text-md-on-error-container dark:bg-md-error-container/30',
    icon: <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-md-error" aria-hidden="true" />,
  },
  warning: {
    wrapper: 'border-[hsl(43_96%_50%/0.4)] bg-[hsl(43_96%_50%/0.1)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]',
    icon: <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-[hsl(38_92%_42%)] dark:text-[hsl(43_96%_62%)]" aria-hidden="true" />,
  },
  info: {
    wrapper: 'border-md-primary-container bg-md-primary-container/40 text-md-on-primary-container dark:bg-md-primary-container/20',
    icon: <Info className="h-5 w-5 mt-0.5 shrink-0 text-md-primary" aria-hidden="true" />,
  },
};

/**
 * Sanitize announcement HTML for safe injection.
 *
 * Uses the same top-level DOMPurify import pattern as portal/announcements.tsx.
 * The `output: 'export'` build has no server render pass, so DOMPurify always
 * runs in the browser where it is fully available.
 */
function sanitizeAnnContent(raw: string): string {
  return DOMPurify.sanitize(raw.replace(/\n/g, '<br/>'));
}

export default function PortalDashboardPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const router = useRouter();
  // Use the shared context refresh() — eliminates duplicate /portal/me calls
  // and closes the race where a context update overwrites fresh local state.
  const { customer, subscriptions, loading, refresh } = useCustomer();

  const [refreshing, setRefreshing] = useState(false);
  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([]);
  const [annError, setAnnError] = useState(false);
  const [dismissed, setDismissed] = useState<Set<number>>(() => new Set());
  // Single page-level live region for copy feedback (replaces per-card aria-live).
  const [copyAnnounce, setCopyAnnounce] = useState('');

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch {
      toast.error(t('refreshFailed'));
    } finally {
      setRefreshing(false);
    }
  }, [refresh, toast, t]);

  const loadAnnouncements = useCallback(() => {
    PortalPublicService.portalAnnouncements()
      .then((data) => {
        setAnnouncements(((data as PortalAnnouncement[]) ?? []).slice(0, 3));
        setAnnError(false);
      })
      .catch((e) => {
        if (process.env.NODE_ENV !== 'production') console.warn('Failed to load announcements', e);
        setAnnError(true);
      });
  }, []);

  useEffect(() => {
    loadAnnouncements();
  }, [loadAnnouncements]);

  // Refresh subscriptions on tab focus only — the CustomerProvider already
  // fetches once on mount, so we skip the initial load→ready transition.
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (loading || !customer) return;
    if (!hasMountedRef.current) {
      // First time auth settles: mark mounted, no extra fetch needed.
      hasMountedRef.current = true;
      const onVisible = () => {
        if (document.visibilityState === 'visible') handleRefresh();
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => document.removeEventListener('visibilitychange', onVisible);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, customer]);

  useEffect(() => {
    if (!loading && !customer) router.replace('/portal/login');
  }, [loading, customer, router]);

  const visibleAnnouncements = announcements.filter((a) => !dismissed.has(a.id));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        {/* M3 circular indeterminate progress */}
        <div className="relative h-10 w-10">
          <svg
            className="animate-spin motion-reduce:animate-none"
            viewBox="0 0 40 40"
            fill="none"
            aria-hidden="true"
            style={{ animation: 'spin 1.2s linear infinite' }}
          >
            <circle
              cx="20" cy="20" r="16"
              strokeWidth="3.5"
              className="stroke-md-surface-container-highest"
            />
            <path
              d="M20 4 a16 16 0 0 1 16 16"
              strokeWidth="3.5"
              strokeLinecap="round"
              className="stroke-md-primary"
            />
          </svg>
        </div>
      </div>
    );
  }
  if (!customer) return null;

  const displayName = customer.nickname || customer.email?.split('@')[0] || t('userFallback');

  return (
    <PageContainer width="content">
      {/* Single page-level live region for copy feedback — avoids per-card duplicates */}
      <span aria-live="polite" className="sr-only">{copyAnnounce}</span>

      {/* Welcome header — delay 80ms so PageContainer fade-in leads */}
      <PageHeader
        icon={<LayoutDashboard />}
        title={
          <>
            {t('welcomeBack')},{' '}
            <span className="text-md-primary">{displayName}</span>
          </>
        }
        description={t('dashboardSubtitle')}
        accent="primary"
        className="[animation-delay:80ms]"
      />

      {/* Announcement banners */}
      {annError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-md-outline-variant bg-md-surface-container p-4"
        >
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Megaphone className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('announcementsLoadFailed')}
          </span>
          {/* min-h-[3rem] ensures ≥48px touch target on mobile */}
          <Button
            type="button"
            variant="outline"
            size="default"
            className="min-h-[3rem]"
            onClick={loadAnnouncements}
          >
            {t('retry')}
          </Button>
        </div>
      ) : visibleAnnouncements.length > 0 ? (
        <div className="space-y-3" role="region" aria-label={t('announcements')}>
          {visibleAnnouncements.map((ann, i) => {
            const style = BANNER_STYLES[ann.level] ?? BANNER_STYLES.info;
            const isUrgent = ann.level === 'critical' || ann.level === 'warning';
            const severityLabel = ann.level === 'critical'
              ? t('announcementCritical')
              : ann.level === 'warning'
              ? t('announcementWarning')
              : undefined;
            return (
              <div
                key={ann.id}
                role={isUrgent ? 'alert' : 'status'}
                className={`flex items-start gap-3 rounded-xl border p-4 animate-slide-up ${style.wrapper}`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {style.icon}
                <div className="min-w-0 flex-1">
                  {severityLabel && <span className="sr-only">{severityLabel}: </span>}
                  <h3 className="font-600 text-sm">{ann.title}</h3>
                  {ann.content && (
                    <p
                      className="mt-1 text-sm opacity-80 leading-relaxed"
                      // Content is sanitized server-side by sanitizeAnnContent (SSR returns '').
                      // Client hydration replaces with DOMPurify-cleaned markup.
                      dangerouslySetInnerHTML={{ __html: sanitizeAnnContent(ann.content) }}
                    />
                  )}
                </div>
                {/* size="icon" = size-10 (40px); min-h/min-w ensure ≥48px touch target */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 -mr-1 -mt-1 min-h-[3rem] min-w-[3rem]"
                  onClick={() => setDismissed((prev) => new Set(prev).add(ann.id))}
                  aria-label={t('dismiss')}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Subscriptions section */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 className="font-display text-lg font-600 text-foreground">
            {t('currentSubscription')}
          </h2>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={handleRefresh}
              loading={refreshing}
              aria-label={t('refreshSubscriptions')}
            >
              {!refreshing && <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            </Button>
            <Button
              variant="outline"
              asChild
            >
              <Link href="/portal/plans" aria-label={t('buyPlan')}>
                <Package className="h-4 w-4 mr-1.5" aria-hidden="true" />
                {t('buyPlan')}
              </Link>
            </Button>
          </div>
        </div>

        {subscriptions.length === 0 ? (
          /* Empty state */
          <Card className="rounded-xl border-dashed border-2 border-border bg-card">
            <CardContent className="flex flex-col items-center justify-center py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-md-surface-container-high mb-4">
                <Package className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="font-display font-600 text-foreground mb-1">{t('noSubscription')}</p>
              <p className="text-sm text-muted-foreground mb-5">
                {t('noSubDesc')}
              </p>
              <Button asChild className="h-12">
                <Link href="/portal/plans">{t('browsePlans')}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {subscriptions.map((sub, i) => (
              <SubscriptionCard
                key={sub.id}
                sub={sub as SubWithPlan}
                index={i}
                onCopied={() => {
                  setCopyAnnounce('');
                  // Next tick: set text so aria-live fires even when consecutive copies happen.
                  requestAnimationFrame(() => setCopyAnnounce(t('copied')));
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <ul role="list" className="grid gap-3 sm:grid-cols-3">
        {[
          {
            href: '/portal/plans',
            icon: <Package className="h-5 w-5" aria-hidden="true" />,
            label: t('buyPlan'),
            desc: t('browsePlansDesc'),
            iconBg: 'bg-md-primary-container text-md-on-primary-container',
          },
          {
            href: '/portal/tickets',
            icon: <MessageSquare className="h-5 w-5" aria-hidden="true" />,
            label: t('submitTicket'),
            desc: t('ticketDesc'),
            iconBg: 'bg-md-secondary-container text-md-on-secondary-container',
          },
          {
            href: '/portal/orders',
            icon: <Gift className="h-5 w-5" aria-hidden="true" />,
            label: t('navOrders'),
            desc: t('ordersDesc'),
            iconBg: 'bg-md-tertiary-container text-md-on-tertiary-container',
          },
        ].map((item, i) => (
          <li key={item.href}>
            <Link href={item.href} className="group block" aria-label={`${item.label} - ${item.desc}`}>
              <div
                className="hover-state state-layer rounded-xl border border-border bg-card p-5
                  flex items-center gap-4 cursor-pointer transition-[box-shadow,border-color]
                  hover:elevation-1 hover:border-md-outline active:scale-[0.98]
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary
                  animate-slide-up"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl
                    transition-transform group-hover:scale-105 motion-reduce:group-hover:scale-100 ${item.iconBg}`}
                >
                  {item.icon}
                </div>
                <div>
                  <p className="font-display text-sm font-600 text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
