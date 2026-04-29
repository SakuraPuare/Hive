import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import type { CustomerSubscription } from '@/lib/portal-auth';

type SubWithPlan = CustomerSubscription & { plan_name?: string };
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Package, MessageSquare, Megaphone, Zap, Clock, Shield, Gift } from 'lucide-react';
import { PortalPublicService } from '@/src/generated/client';
import DOMPurify from 'dompurify';

function trafficGB(bytes: number) {
  return (bytes / (1024 ** 3)).toFixed(2);
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

  function copyToClipboard(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  }

  const gradients = [
    'from-blue-500/10 to-indigo-500/10 dark:from-blue-500/20 dark:to-indigo-500/20',
    'from-purple-500/10 to-pink-500/10 dark:from-purple-500/20 dark:to-pink-500/20',
    'from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/20 dark:to-teal-500/20',
  ];

  return (
    <Card className="overflow-hidden animate-slide-up" style={{ animationDelay: `${index * 80}ms` }}>
      <div className={`h-1.5 w-full ${isExpired ? 'bg-destructive/60' : 'gradient-border'}`} />
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">{sub.plan_name}</CardTitle>
          <Badge
            variant={isExpired ? 'destructive' : 'default'}
            className={isExpired ? '' : 'bg-primary/10 text-primary hover:bg-primary/20 border-0'}
          >
            {isExpired ? t('expired') : t('active')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className={`grid grid-cols-3 gap-3 rounded-xl bg-gradient-to-br ${gradients[index % 3]} p-4`}>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Clock className="h-3.5 w-3.5" />
            </div>
            <p className="text-xl font-bold">{isExpired ? 0 : daysLeft}</p>
            <p className="text-xs text-muted-foreground">{t('daysRemaining') || 'days left'}</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Shield className="h-3.5 w-3.5" />
            </div>
            <p className="text-xl font-bold">{sub.device_limit}</p>
            <p className="text-xs text-muted-foreground">{t('devices')}</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
              <Zap className="h-3.5 w-3.5" />
            </div>
            <p className="text-xl font-bold">{sub.traffic_limit === 0 ? '∞' : totalGB}</p>
            <p className="text-xs text-muted-foreground">{t('gb') || 'GB'}</p>
          </div>
        </div>

        {/* Traffic progress */}
        {(sub.traffic_limit ?? 0) > 0 && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('trafficUsage')}</span>
              <span className="font-medium">{usedGB} / {totalGB} GB</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  pct > 80 ? 'bg-destructive' : pct > 50 ? 'bg-yellow-500' : 'bg-primary'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Copy links */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-10"
            onClick={() => copyToClipboard(clashLink, setCopiedClash)}
          >
            {copiedClash ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : <Copy className="h-4 w-4 mr-1.5" />}
            {copiedClash ? t('copied') : t('copyClash')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-10"
            onClick={() => copyToClipboard(vlessLink, setCopiedVless)}
          >
            {copiedVless ? <Check className="h-4 w-4 mr-1.5 text-green-500" /> : <Copy className="h-4 w-4 mr-1.5" />}
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

const BANNER_STYLES: Record<string, string> = {
  critical: 'border-red-200 bg-red-50 text-red-900 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200',
  warning: 'border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-500/20 dark:bg-yellow-500/10 dark:text-yellow-200',
  info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200',
};

export default function PortalDashboardPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
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
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!customer) return null;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Welcome header */}
      <div className="rounded-2xl gradient-brand-subtle p-6 md:p-8">
        <h1 className="text-2xl font-bold tracking-tight">
          {t('welcomeBack') || 'Welcome back'}, {customer.nickname || customer.email?.split('@')[0]}
        </h1>
        <p className="mt-1.5 text-muted-foreground">
          {t('dashboardSubtitle') || 'Manage your subscriptions and account.'}
        </p>
      </div>

      {/* Announcement banners */}
      {announcements.length > 0 && (
        <div className="space-y-3">
          {announcements.map((ann) => (
            <div
              key={ann.id}
              className={`flex items-start gap-3 rounded-xl border p-4 ${BANNER_STYLES[ann.level] ?? BANNER_STYLES.info}`}
            >
              <Megaphone className="h-5 w-5 mt-0.5 shrink-0 opacity-70" />
              <div>
                <p className="font-semibold">{ann.title}</p>
                {ann.content && (
                  <p className="mt-1 text-sm opacity-80" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(ann.content.replace(/\n/g, '<br/>')) }} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Subscriptions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('currentSubscription')}</h2>
          <Button variant="outline" size="sm" asChild>
            <Link href="/portal/plans">
              <Package className="h-4 w-4 mr-1.5" />
              {t('buyPlan')}
            </Link>
          </Button>
        </div>
        {subscriptions.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mb-4">
                <Package className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="font-medium mb-1">{t('noSubscription')}</p>
              <p className="text-sm text-muted-foreground mb-4">{t('noSubDesc') || 'Browse our plans and get started.'}</p>
              <Button asChild>
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
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/portal/plans" className="group">
          <Card className="transition-all hover:shadow-md hover:border-primary/30">
            <CardContent className="flex items-center gap-4 py-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform">
                <Package className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">{t('buyPlan')}</p>
                <p className="text-xs text-muted-foreground">{t('browsePlansDesc') || 'View available plans'}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/portal/tickets" className="group">
          <Card className="transition-all hover:shadow-md hover:border-primary/30">
            <CardContent className="flex items-center gap-4 py-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 group-hover:scale-110 transition-transform">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">{t('submitTicket')}</p>
                <p className="text-xs text-muted-foreground">{t('ticketDesc') || 'Need help? Open a ticket'}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/portal/orders" className="group">
          <Card className="transition-all hover:shadow-md hover:border-primary/30">
            <CardContent className="flex items-center gap-4 py-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform">
                <Gift className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">{t('navOrders')}</p>
                <p className="text-xs text-muted-foreground">{t('ordersDesc') || 'View your order history'}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
