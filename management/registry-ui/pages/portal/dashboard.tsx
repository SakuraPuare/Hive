import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import type { CustomerSubscription } from '@/lib/portal-auth';

type SubWithPlan = CustomerSubscription & { plan_name?: string };
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check, Package, MessageSquare, Megaphone, Zap, Clock, Shield, Gift, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { PortalPublicService } from '@/src/generated/client';
import DOMPurify from 'dompurify';

function trafficGB(bytes: number) {
  return (bytes / (1024 ** 3)).toFixed(2);
}

function copyToClipboard(text: string, setter: (v: boolean) => void) {
  navigator.clipboard.writeText(text);
  setter(true);
  setTimeout(() => setter(false), 2000);
}

function SubscriptionCard({ sub, index }: { sub: SubWithPlan; index: number }) {
  const t = useTranslations('portal');
  const [copiedClash, setCopiedClash] = useState(false);
  const [copiedVless, setCopiedVless] = useState(false);

  const isExpired = new Date(sub.expires_at ?? '') < new Date();
  const usedGB = trafficGB(sub.traffic_used ?? 0);
  const totalGB = sub.traffic_limit === 0 ? t('unlimited') : trafficGB(sub.traffic_limit ?? 0);
  const pct = (sub.traffic_limit ?? 0) > 0 ? Math.min(100, ((sub.traffic_used ?? 0) / (sub.traffic_limit ?? 1)) * 100) : 0;

  const daysLeft = Math.max(0, Math.ceil((new Date(sub.expires_at ?? '').getTime() - Date.now()) / (1000 * 60 * 60 * 24)));

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const clashLink = `${origin}/c/${sub.token}`;
  const vlessLink = `${origin}/c/${sub.token}/vless`;

  // Traffic bar color: use M3 semantic roles
  const barColor = pct > 80
    ? 'bg-md-error'
    : pct > 50
    ? 'bg-[hsl(43_96%_50%)]'
    : 'bg-md-primary';

  return (
    <Card
      className="overflow-hidden rounded-xl border bg-card animate-slide-up"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Top accent strip */}
      <div className={`h-1 w-full ${isExpired ? 'bg-md-error' : 'bg-md-primary'}`} />

      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="font-display text-base font-600 text-foreground">
            {sub.plan_name}
          </CardTitle>
          {isExpired ? (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500
              bg-md-error-container text-md-on-error-container">
              <span className="size-1.5 rounded-full bg-md-error" />
              {t('expired')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500
              bg-md-tertiary-container text-md-on-tertiary-container">
              <span className="size-1.5 rounded-full bg-md-tertiary" />
              {t('active')}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 px-5 pb-5">
        {/* Stats row — tonal container surface */}
        <div className="grid grid-cols-3 gap-3 rounded-xl bg-md-surface-container p-4">
          <div className="text-center">
            <Clock className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" />
            <p className="font-display text-xl font-700 text-foreground">
              {isExpired ? 0 : daysLeft}
            </p>
            <p className="text-xs text-muted-foreground">{t('daysRemaining') || 'days left'}</p>
          </div>
          <div className="text-center">
            <Shield className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" />
            <p className="font-display text-xl font-700 text-foreground">
              {sub.device_limit}
            </p>
            <p className="text-xs text-muted-foreground">{t('devices')}</p>
          </div>
          <div className="text-center">
            <Zap className="h-3.5 w-3.5 mx-auto mb-1 text-muted-foreground" />
            <p className="font-display text-xl font-700 text-foreground">
              {sub.traffic_limit === 0 ? '∞' : totalGB}
            </p>
            <p className="text-xs text-muted-foreground">{t('gb') || 'GB'}</p>
          </div>
        </div>

        {/* Traffic progress */}
        {(sub.traffic_limit ?? 0) > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('trafficUsage')}</span>
              <span className="font-500 text-foreground">{usedGB} / {totalGB} GB</span>
            </div>
            <div className="h-2 rounded-full bg-md-surface-container-high overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Copy link buttons */}
        <div className="flex gap-2">
          <button
            className="state-layer ripple flex-1 inline-flex items-center justify-center gap-1.5
              rounded-lg border border-border bg-md-surface-container-low h-10 px-3
              text-sm font-500 text-foreground
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
              transition-colors"
            onClick={() => copyToClipboard(clashLink, setCopiedClash)}
          >
            {copiedClash
              ? <Check className="h-4 w-4 text-md-tertiary" />
              : <Copy className="h-4 w-4 text-muted-foreground" />
            }
            {copiedClash ? t('copied') : t('copyClash')}
          </button>
          <button
            className="state-layer ripple flex-1 inline-flex items-center justify-center gap-1.5
              rounded-lg border border-border bg-md-surface-container-low h-10 px-3
              text-sm font-500 text-foreground
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
              transition-colors"
            onClick={() => copyToClipboard(vlessLink, setCopiedVless)}
          >
            {copiedVless
              ? <Check className="h-4 w-4 text-md-tertiary" />
              : <Copy className="h-4 w-4 text-muted-foreground" />
            }
            {copiedVless ? t('copied') : t('copyVless')}
          </button>
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
    icon: <AlertCircle className="h-5 w-5 mt-0.5 shrink-0 text-md-error" />,
  },
  warning: {
    wrapper: 'border-[hsl(43_96%_50%/0.4)] bg-[hsl(43_96%_50%/0.1)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]',
    icon: <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-[hsl(38_92%_42%)] dark:text-[hsl(43_96%_62%)]" />,
  },
  info: {
    wrapper: 'border-md-primary-container bg-md-primary-container/40 text-md-on-primary-container dark:bg-md-primary-container/20',
    icon: <Info className="h-5 w-5 mt-0.5 shrink-0 text-md-primary" />,
  },
};

export default function PortalDashboardPage() {
  const t = useTranslations('portal');
  const router = useRouter();
  const { customer, subscriptions, loading } = useCustomer();
  const [announcements, setAnnouncements] = useState<PortalAnnouncement[]>([]);

  useEffect(() => {
    PortalPublicService.portalAnnouncements()
      .then((data) => setAnnouncements(((data as PortalAnnouncement[]) ?? []).slice(0, 3)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading && !customer) router.replace('/portal/login');
  }, [loading, customer, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        {/* M3 circular indeterminate progress */}
        <div className="relative h-10 w-10">
          <svg
            className="animate-spin"
            viewBox="0 0 40 40"
            fill="none"
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

  return (
    <div className="space-y-8 animate-fade-in">

      {/* Welcome hero — surface container, no old gradient */}
      <div className="rounded-2xl bg-md-surface-container border border-border px-6 py-7 md:px-8 md:py-9">
        <p className="text-xs font-500 text-muted-foreground uppercase tracking-wide mb-1">
          {t('dashboardSubtitle') || 'Manage your subscriptions and account.'}
        </p>
        <h1 className="font-display text-2xl font-700 text-foreground tracking-tight">
          {t('welcomeBack') || 'Welcome back'},{' '}
          <span className="text-md-primary">
            {customer.nickname || customer.email?.split('@')[0]}
          </span>
        </h1>
      </div>

      {/* Announcement banners */}
      {announcements.length > 0 && (
        <div className="space-y-3">
          {announcements.map((ann, i) => {
            const style = BANNER_STYLES[ann.level] ?? BANNER_STYLES.info;
            return (
              <div
                key={ann.id}
                className={`flex items-start gap-3 rounded-xl border p-4 animate-slide-up ${style.wrapper}`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {style.icon}
                <div>
                  <p className="font-600 text-sm">{ann.title}</p>
                  {ann.content && (
                    // react-doctor-disable-next-line react-doctor/no-danger -- content is sanitized with DOMPurify before injection
                    <p
                      className="mt-1 text-sm opacity-80 leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(ann.content.replace(/\n/g, '<br/>')) }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Subscriptions section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-600 text-foreground">
            {t('currentSubscription')}
          </h2>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="state-layer rounded-lg border border-border bg-md-surface-container-low
              text-sm font-500 text-foreground
              focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
          >
            <Link href="/portal/plans">
              <Package className="h-4 w-4 mr-1.5" />
              {t('buyPlan')}
            </Link>
          </Button>
        </div>

        {subscriptions.length === 0 ? (
          /* Empty state */
          <Card className="rounded-xl border-dashed border-2 border-border bg-card">
            <CardContent className="flex flex-col items-center justify-center py-14 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-md-surface-container-high mb-4">
                <Package className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="font-display font-600 text-foreground mb-1">{t('noSubscription')}</p>
              <p className="text-sm text-muted-foreground mb-5">
                {t('noSubDesc') || 'Browse our plans and get started.'}
              </p>
              <Button
                asChild
                className="state-layer ripple rounded-lg px-5 py-2.5 text-sm font-500
                  bg-md-primary text-md-on-primary elevation-1
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              >
                <Link href="/portal/plans">{t('browsePlans') || 'Browse Plans'}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {subscriptions.map((sub, i) => (
              <SubscriptionCard key={sub.id} sub={sub} index={i} />
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            href: '/portal/plans',
            icon: <Package className="h-5 w-5" />,
            label: t('buyPlan'),
            desc: t('browsePlansDesc') || 'View available plans',
            iconBg: 'bg-md-primary-container text-md-on-primary-container',
          },
          {
            href: '/portal/tickets',
            icon: <MessageSquare className="h-5 w-5" />,
            label: t('submitTicket'),
            desc: t('ticketDesc') || 'Need help? Open a ticket',
            iconBg: 'bg-md-secondary-container text-md-on-secondary-container',
          },
          {
            href: '/portal/orders',
            icon: <Gift className="h-5 w-5" />,
            label: t('navOrders'),
            desc: t('ordersDesc') || 'View your order history',
            iconBg: 'bg-md-tertiary-container text-md-on-tertiary-container',
          },
        ].map((item, i) => (
          <Link key={item.href} href={item.href} className="group">
            <div
              className="hover-state state-layer rounded-xl border border-border bg-card p-5
                flex items-center gap-4 transition-[box-shadow,border-color]
                hover:elevation-1 hover:border-md-outline
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary
                animate-slide-up"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl
                  transition-transform group-hover:scale-105 ${item.iconBg}`}
              >
                {item.icon}
              </div>
              <div>
                <p className="font-display text-sm font-600 text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
