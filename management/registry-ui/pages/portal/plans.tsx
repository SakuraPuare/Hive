import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { PortalPublicService, PortalService } from '@/src/generated/client';
import { portalSessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import type { model_Plan } from '@/src/generated/client/models/model_Plan';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Zap, Loader2, AlertCircle } from 'lucide-react';

function formatTraffic(bytes: number, t: ReturnType<typeof useTranslations>) {
  if (bytes === 0) return t('unlimited');
  return `${(bytes / (1024 ** 3)).toFixed(0)} GB`;
}

function formatPrice(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

export default function PortalPlansPage() {
  const t = useTranslations('portal');
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
    } catch (e) {
      alert(getErrorMessage(e, t('loadFailed')));
    } finally {
      setBuyingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        {/* M3 circular indeterminate progress */}
        <div className="relative h-12 w-12">
          <svg
            className="animate-spin"
            viewBox="0 0 48 48"
            fill="none"
            style={{ animation: 'spin 1.4s linear infinite' }}
          >
            <circle
              cx="24" cy="24" r="20"
              stroke="hsl(var(--md-primary) / 0.2)"
              strokeWidth="4"
            />
            <circle
              cx="24" cy="24" r="20"
              stroke="hsl(var(--md-primary))"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="100"
              strokeDashoffset="60"
            />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground animate-fade-in">{t('plansTitle')}</p>
      </div>
    );
  }

  const enabledPlans = plans.filter((p) => p.enabled);
  const recommendedIdx = enabledPlans.length > 1 ? 1 : 0;

  return (
    <div className="space-y-10 animate-fade-in">
      {/* Hero / title区 — surface container，非旧渐变 */}
      <div className="rounded-2xl bg-md-surface-container-low border px-8 py-10 text-center animate-slide-up">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-md-primary-container mb-4">
          <Zap className="h-6 w-6 text-md-on-primary-container" />
        </div>
        <h1 className="font-display text-3xl font-600 tracking-tight text-foreground">
          {t('plansTitle')}
        </h1>
        <p className="mt-2 text-base text-muted-foreground leading-relaxed max-w-sm mx-auto">
          {t('plansSubtitle') || 'Choose a plan that fits your needs.'}
        </p>
      </div>

      {/* 错误提示 — error container */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl bg-md-error-container px-4 py-3 animate-slide-up">
          <AlertCircle className="h-4 w-4 shrink-0 text-md-on-error-container" />
          <p className="text-sm font-500 text-md-on-error-container">{error}</p>
        </div>
      )}

      {/* 套餐卡片网格 */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl mx-auto">
        {enabledPlans.map((plan, i) => {
          const isRecommended = i === recommendedIdx;
          return (
            <Card
              key={plan.id}
              className={`relative flex flex-col overflow-hidden rounded-xl border transition-all duration-300 animate-slide-up ${
                isRecommended
                  ? 'bg-md-primary-container border-md-primary ring-1 ring-md-primary elevation-1'
                  : 'bg-card hover:elevation-1'
              }`}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              {/* 推荐徽章 — tonal chip，右上角 */}
              {isRecommended && (
                <div className="absolute top-0 right-0">
                  <span className="inline-flex items-center gap-1 rounded-bl-xl rounded-tr-xl px-3 py-1.5
                    bg-md-primary text-md-on-primary text-xs font-500">
                    <Zap className="h-3 w-3" />
                    {t('recommended') || 'Popular'}
                  </span>
                </div>
              )}

              <CardHeader className="pb-4 pt-6 px-6">
                <CardTitle className={`font-display text-xl font-600 ${isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}`}>
                  {plan.name}
                </CardTitle>
                {/* 价格区 */}
                <div className="mt-4 flex items-baseline gap-1">
                  <span className={`font-display text-4xl font-700 tracking-tight ${isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}`}>
                    {formatPrice(plan.price ?? 0)}
                  </span>
                  <span className={`text-sm ${isRecommended ? 'text-md-on-primary-container/70' : 'text-muted-foreground'}`}>
                    / {plan.duration_days} {t('days') || 'days'}
                  </span>
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col justify-between px-6 pb-6">
                {/* 特性列表 */}
                <ul className="space-y-3 mb-6">
                  <li className="flex items-center gap-2.5 text-sm">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isRecommended ? 'bg-md-on-primary-container/15' : 'bg-md-tertiary-container'}`}>
                      <Check className={`h-3 w-3 ${isRecommended ? 'text-md-on-primary-container' : 'text-md-on-tertiary-container'}`} />
                    </span>
                    <span className={isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}>
                      {formatTraffic(plan.traffic_limit ?? 0, t)} {t('trafficQuota') || 'traffic'}
                    </span>
                  </li>
                  <li className="flex items-center gap-2.5 text-sm">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isRecommended ? 'bg-md-on-primary-container/15' : 'bg-md-tertiary-container'}`}>
                      <Check className={`h-3 w-3 ${isRecommended ? 'text-md-on-primary-container' : 'text-md-on-tertiary-container'}`} />
                    </span>
                    <span className={isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}>
                      {plan.device_limit} {t('devices')} {t('simultaneous') || 'simultaneous'}
                    </span>
                  </li>
                  {(plan.speed_limit ?? 0) > 0 ? (
                    <li className="flex items-center gap-2.5 text-sm">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isRecommended ? 'bg-md-on-primary-container/15' : 'bg-md-tertiary-container'}`}>
                        <Check className={`h-3 w-3 ${isRecommended ? 'text-md-on-primary-container' : 'text-md-on-tertiary-container'}`} />
                      </span>
                      <span className={isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}>
                        {plan.speed_limit} Mbps
                      </span>
                    </li>
                  ) : (
                    <li className="flex items-center gap-2.5 text-sm">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isRecommended ? 'bg-md-on-primary-container/15' : 'bg-md-tertiary-container'}`}>
                        <Check className={`h-3 w-3 ${isRecommended ? 'text-md-on-primary-container' : 'text-md-on-tertiary-container'}`} />
                      </span>
                      <span className={isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}>
                        {t('noSpeedLimit') || 'Unlimited speed'}
                      </span>
                    </li>
                  )}
                  <li className="flex items-center gap-2.5 text-sm">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isRecommended ? 'bg-md-on-primary-container/15' : 'bg-md-tertiary-container'}`}>
                      <Check className={`h-3 w-3 ${isRecommended ? 'text-md-on-primary-container' : 'text-md-on-tertiary-container'}`} />
                    </span>
                    <span className={isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}>
                      {t('allNodes') || 'All available nodes'}
                    </span>
                  </li>
                </ul>

                {/* 购买按钮 */}
                <Button
                  className={`state-layer ripple w-full h-11 rounded-lg text-sm font-500 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-md-primary ${
                    isRecommended
                      ? 'bg-md-primary text-md-on-primary elevation-1 hover:elevation-2'
                      : 'bg-md-secondary-container text-md-on-secondary-container hover:elevation-1'
                  }`}
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
