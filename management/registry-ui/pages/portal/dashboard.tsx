import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import type { CustomerSubscription } from '@/lib/portal-auth';

// Backend returns plan_name via JOIN; extend the generated type locally
type SubWithPlan = CustomerSubscription & { plan_name?: string };
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Check, Package, MessageSquare, Megaphone } from 'lucide-react';
import { PortalPublicService } from '@/src/generated/client';
import DOMPurify from 'dompurify';

function trafficGB(bytes: number) {
  return (bytes / (1024 ** 3)).toFixed(2);
}

function SubscriptionCard({ sub }: { sub: SubWithPlan }) {
  const t = useTranslations('portal');
  const [copiedClash, setCopiedClash] = useState(false);
  const [copiedVless, setCopiedVless] = useState(false);

  const isExpired = new Date(sub.expires_at ?? '') < new Date();
  const usedGB = trafficGB(sub.traffic_used ?? 0);
  const totalGB = sub.traffic_limit === 0 ? t('unlimited') : trafficGB(sub.traffic_limit ?? 0);
  const pct = (sub.traffic_limit ?? 0) > 0 ? Math.min(100, ((sub.traffic_used ?? 0) / (sub.traffic_limit ?? 1)) * 100) : 0;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const clashLink = `${origin}/c/${sub.token}`;
  const vlessLink = `${origin}/c/${sub.token}/vless`;

  function copyToClipboard(text: string, setter: (v: boolean) => void) {
    navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{sub.plan_name}</CardTitle>
          <Badge variant={isExpired ? 'destructive' : 'default'}>
            {isExpired ? t('expired') : t('active')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">{t('expiresAt')}</span>
            <p className="font-medium">{new Date(sub.expires_at ?? '').toLocaleDateString('zh-CN')}</p>
          </div>
          <div>
            <span className="text-muted-foreground">{t('deviceLimit')}</span>
            <p className="font-medium">{sub.device_limit} {t('devices')}</p>
          </div>
        </div>

        {/* Traffic progress */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t('trafficUsage')}</span>
            <span className="text-muted-foreground">{usedGB} / {totalGB} GB</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(sub.traffic_limit ?? 0) > 0 ? pct : 0}%` }}
            />
          </div>
        </div>

        {/* Copy links */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => copyToClipboard(clashLink, setCopiedClash)}
          >
            {copiedClash ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            {copiedClash ? t('copied') : t('copyClash')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => copyToClipboard(vlessLink, setCopiedVless)}
          >
            {copiedVless ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
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

const BANNER_COLORS: Record<string, string> = {
  critical: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
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

  if (loading) return <p className="p-6 text-sm text-muted-foreground">{tCommon('loading')}</p>;
  if (!customer) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t('dashboard')}</h1>

      {/* Announcement banners */}
      {announcements.length > 0 && (
        <div className="space-y-2">
          {announcements.map((ann) => (
            <div
              key={ann.id}
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${BANNER_COLORS[ann.level] ?? BANNER_COLORS.info}`}
            >
              <Megaphone className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <span className="font-medium">{ann.title}</span>
                {ann.content && (
                  <p className="mt-0.5 opacity-90" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(ann.content.replace(/\n/g, '<br/>')) }} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Subscriptions */}
      <div>
        <h2 className="text-base font-medium mb-3">{t('currentSubscription')}</h2>
        {subscriptions.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {t('noSubscription')}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {subscriptions.map((sub) => (
              <SubscriptionCard key={sub.id} sub={sub} />
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-base font-medium mb-3">{t('quickActions')}</h2>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/portal/plans">
              <Package className="h-4 w-4 mr-1.5" />
              {t('buyPlan')}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/portal/tickets">
              <MessageSquare className="h-4 w-4 mr-1.5" />
              {t('submitTicket')}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
