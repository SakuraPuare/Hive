import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { PortalPublicService, PortalService } from '@/src/generated/client';
import { portalSessionApi } from '@/lib/openapi-session';
import type { model_Plan } from '@/src/generated/client/models/model_Plan';
import { ApiError } from '@/src/generated/client/core/ApiError';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Zap, Loader2 } from 'lucide-react';

function formatTraffic(bytes: number, t: any) {
  if (bytes === 0) return t('unlimited');
  return `${(bytes / (1024 ** 3)).toFixed(0)} GB`;
}

function formatPrice(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default function PortalPlansPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [plans, setPlans] = useState<model_Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buyingId, setBuyingId] = useState<number | null>(null);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await PortalPublicService.portalPlans();
      setPlans(data);
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadPlans(); }, [loadPlans]);

  async function handleBuy(planId: number) {
    setBuyingId(planId);
    try {
      await portalSessionApi(PortalService.portalCreateOrder({ requestBody: { plan_id: planId } }));
      router.push('/portal/orders');
    } catch (e: any) {
      alert(e?.error || t('loadFailed'));
    } finally {
      setBuyingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  const enabledPlans = plans.filter((p) => p.enabled);
  const recommendedIdx = enabledPlans.length > 1 ? 1 : 0;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">{t('plansTitle')}</h1>
        <p className="mt-2 text-muted-foreground">{t('plansSubtitle') || 'Choose a plan that fits your needs.'}</p>
      </div>
      {error && <p className="text-sm text-destructive text-center">{error}</p>}

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl mx-auto">
        {enabledPlans.map((plan, i) => {
          const isRecommended = i === recommendedIdx;
          return (
            <Card
              key={plan.id}
              className={`relative flex flex-col overflow-hidden transition-all hover:shadow-lg animate-slide-up ${
                isRecommended ? 'ring-2 ring-primary shadow-lg' : ''
              }`}
              style={{ animationDelay: `${i * 100}ms` }}
            >
              {isRecommended && (
                <div className="absolute top-0 right-0">
                  <Badge className="rounded-none rounded-bl-lg bg-primary text-primary-foreground text-xs px-3 py-1">
                    <Zap className="h-3 w-3 mr-1" />
                    {t('recommended') || 'Popular'}
                  </Badge>
                </div>
              )}
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">{plan.name}</CardTitle>
                <div className="mt-3">
                  <span className="text-3xl font-bold">{formatPrice(plan.price ?? 0)}</span>
                  <span className="text-sm text-muted-foreground ml-1">/ {plan.duration_days} {t('days') || 'days'}</span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between">
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center gap-2.5 text-sm">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span>{formatTraffic(plan.traffic_limit ?? 0, t)} {t('trafficQuota') || 'traffic'}</span>
                  </li>
                  <li className="flex items-center gap-2.5 text-sm">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span>{plan.device_limit} {t('devices')} {t('simultaneous') || 'simultaneous'}</span>
                  </li>
                  {(plan.speed_limit ?? 0) > 0 ? (
                    <li className="flex items-center gap-2.5 text-sm">
                      <Check className="h-4 w-4 text-primary shrink-0" />
                      <span>{plan.speed_limit} Mbps</span>
                    </li>
                  ) : (
                    <li className="flex items-center gap-2.5 text-sm">
                      <Check className="h-4 w-4 text-primary shrink-0" />
                      <span>{t('noSpeedLimit') || 'Unlimited speed'}</span>
                    </li>
                  )}
                  <li className="flex items-center gap-2.5 text-sm">
                    <Check className="h-4 w-4 text-primary shrink-0" />
                    <span>{t('allNodes') || 'All available nodes'}</span>
                  </li>
                </ul>
                <Button
                  className={`w-full h-11 ${isRecommended ? '' : 'variant-outline'}`}
                  variant={isRecommended ? 'default' : 'outline'}
                  onClick={() => handleBuy(plan.id!)}
                  disabled={buyingId === plan.id}
                >
                  {buyingId === plan.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t('buy')
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
