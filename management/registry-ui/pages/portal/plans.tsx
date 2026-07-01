import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { PortalPublicService, PortalService } from '@/src/generated/client';
import { portalSessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCustomer } from '@/lib/portal-auth';
import type { model_Plan } from '@/src/generated/client/models/model_Plan';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Check, Zap, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';

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
  const toast = useToast();
  const { customer, loading: authLoading } = useCustomer();
  const [plans, setPlans] = useState<model_Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [buyingId, setBuyingId] = useState<number | null>(null);
  // Plan awaiting purchase confirmation (drives the confirm dialog).
  const [confirmPlan, setConfirmPlan] = useState<model_Plan | null>(null);
  // Purchase failure message (drives the error dialog).
  const [buyError, setBuyError] = useState('');

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await PortalPublicService.portalPlans();
      // Sort by sort_order so the admin-defined display order is respected.
      setPlans(data.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)));
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
      const result = await portalSessionApi(
        PortalService.portalCreateOrder({ requestBody: { plan_id: planId } }),
      );
      setConfirmPlan(null);
      toast.success(t('purchaseSuccess'));
      // Navigate to orders, carrying the new order_no so the orders page can
      // surface the freshly created record to the user.
      const dest = result?.order_no
        ? `/portal/orders?highlight=${encodeURIComponent(result.order_no)}`
        : '/portal/orders';
      router.push(dest);
    } catch (e) {
      setConfirmPlan(null);
      setBuyError(getErrorMessage(e, t('purchaseFailed')));
    } finally {
      setBuyingId(null);
    }
  }

  if (loading || authLoading) {
    return (
      <PageContainer width="content">
        <div
          className="flex flex-col items-center justify-center py-24 gap-4"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-10 w-10 animate-spin text-md-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground animate-fade-in">{t('loadingPlans')}</p>
        </div>
      </PageContainer>
    );
  }

  // Sort by sort_order then pick the highest-sort-order enabled plan as "recommended".
  // This gives a stable, admin-controllable selection rather than relying on array index.
  const enabledPlans = plans.filter((p) => p.enabled);
  const recommendedId = enabledPlans.length > 0
    ? enabledPlans[enabledPlans.length - 1].id
    : undefined;

  const isLoggedIn = customer !== null;

  return (
    <PageContainer width="content">
      <PageHeader
        icon={<Zap />}
        title={t('plansTitle')}
        description={t('plansSubtitle')}
        accent="primary"
      />

      {/* 错误提示 — error container */}
      {error && (
        <div
          className="flex items-center gap-3 rounded-xl bg-md-error-container px-4 py-3 animate-slide-up"
          role="alert"
          aria-live="assertive"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-md-on-error-container" aria-hidden="true" />
          <p className="text-sm font-500 text-md-on-error-container flex-1">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={loadPlans}
            className="shrink-0 border-md-on-error-container/30 text-md-on-error-container hover:border-md-on-error-container/60"
          >
            {t('retry')}
          </Button>
        </div>
      )}

      {/* 套餐卡片网格 / 空态 */}
      {enabledPlans.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-2xl bg-md-surface-container-low border px-8 py-16 text-center animate-slide-up"
          role="status"
          aria-live="polite"
        >
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-md-surface-container-high mb-4">
            <Zap className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          </div>
          <h2 className="font-display text-xl font-600 text-foreground">
            {t('noPlansAvailable')}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xs">
            {t('noPlansDesc')}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {enabledPlans.map((plan, i) => {
            const isRecommended = plan.id === recommendedId;
            const titleId = `plan-${plan.id}-title`;
            return (
              <Card
                key={plan.id}
                role="region"
                aria-labelledby={titleId}
                className={`relative flex flex-col overflow-hidden rounded-xl border transition-all duration-300 animate-slide-up ${
                  isRecommended
                    ? 'bg-md-primary-container border-md-primary ring-1 ring-md-primary elevation-1'
                    : 'bg-card'
                }`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                {/* 推荐徽章 — tonal chip，右上角 */}
                {isRecommended && (
                  <div className="absolute top-0 right-0">
                    <Badge
                      variant="default"
                      className="gap-1 rounded-bl-xl rounded-tr-xl rounded-br-none rounded-tl-none px-3 py-1.5 bg-md-primary text-md-on-primary"
                    >
                      <Zap className="h-3 w-3" aria-hidden="true" />
                      {t('recommended')}
                    </Badge>
                  </div>
                )}

                <CardHeader className="pb-4 pt-6 px-6">
                  <h2
                    id={titleId}
                    data-slot="card-title"
                    className={`font-display text-xl font-600 leading-none tracking-tight ${isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}`}
                  >
                    {plan.name}
                  </h2>
                  {/* 价格区 */}
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className={`font-display text-4xl font-700 tracking-tight ${isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}`}>
                      {formatPrice(plan.price ?? 0)}
                    </span>
                    <span className={`text-sm ${isRecommended ? 'text-md-on-primary-container/70' : 'text-muted-foreground'}`}>
                      / {plan.duration_days} {t('days')}
                    </span>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-1 flex-col justify-between px-6 pb-6">
                  {/* 特性列表 */}
                  <ul className="space-y-3 mb-6">
                    <li className="flex items-center gap-2.5 text-sm">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isRecommended ? 'bg-md-on-primary-container/15' : 'bg-md-tertiary-container'}`}>
                        <Check className={`h-3 w-3 ${isRecommended ? 'text-md-on-primary-container' : 'text-md-on-tertiary-container'}`} aria-hidden="true" />
                      </span>
                      <span className={isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}>
                        {formatTraffic(plan.traffic_limit ?? 0, t)} {t('trafficQuota')}
                      </span>
                    </li>
                    <li className="flex items-center gap-2.5 text-sm">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isRecommended ? 'bg-md-on-primary-container/15' : 'bg-md-tertiary-container'}`}>
                        <Check className={`h-3 w-3 ${isRecommended ? 'text-md-on-primary-container' : 'text-md-on-tertiary-container'}`} aria-hidden="true" />
                      </span>
                      <span className={isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}>
                        {plan.device_limit} {t('devices')} {t('simultaneous')}
                      </span>
                    </li>
                    {(plan.speed_limit ?? 0) > 0 ? (
                      <li className="flex items-center gap-2.5 text-sm">
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isRecommended ? 'bg-md-on-primary-container/15' : 'bg-md-tertiary-container'}`}>
                          <Check className={`h-3 w-3 ${isRecommended ? 'text-md-on-primary-container' : 'text-md-on-tertiary-container'}`} aria-hidden="true" />
                        </span>
                        <span className={isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}>
                          {plan.speed_limit} Mbps
                        </span>
                      </li>
                    ) : (
                      <li className="flex items-center gap-2.5 text-sm">
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isRecommended ? 'bg-md-on-primary-container/15' : 'bg-md-tertiary-container'}`}>
                          <Check className={`h-3 w-3 ${isRecommended ? 'text-md-on-primary-container' : 'text-md-on-tertiary-container'}`} aria-hidden="true" />
                        </span>
                        <span className={isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}>
                          {t('noSpeedLimit')}
                        </span>
                      </li>
                    )}
                    <li className="flex items-center gap-2.5 text-sm">
                      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isRecommended ? 'bg-md-on-primary-container/15' : 'bg-md-tertiary-container'}`}>
                        <Check className={`h-3 w-3 ${isRecommended ? 'text-md-on-primary-container' : 'text-md-on-tertiary-container'}`} aria-hidden="true" />
                      </span>
                      <span className={isRecommended ? 'text-md-on-primary-container' : 'text-foreground'}>
                        {t('allNodes')}
                      </span>
                    </li>
                  </ul>

                  {/* 购买按钮 — 未登录时导向登录页，保留 redirect 参数 */}
                  {isLoggedIn ? (
                    <Button
                      className={`w-full h-12 rounded-lg text-sm font-500 ${
                        isRecommended
                          ? 'bg-md-primary text-md-on-primary elevation-1 hover:elevation-2'
                          : 'hover:elevation-1'
                      }`}
                      variant={isRecommended ? 'default' : 'secondary'}
                      onClick={() => setConfirmPlan(plan)}
                      loading={buyingId === plan.id}
                      aria-label={
                        buyingId === plan.id
                          ? `${t('buying')} · ${plan.name}`
                          : `${t('buy')} · ${plan.name} · ${formatPrice(plan.price ?? 0)}`
                      }
                    >
                      {buyingId === plan.id ? t('buying') : t('buy')}
                    </Button>
                  ) : (
                    <Button
                      className={`w-full h-12 rounded-lg text-sm font-500 ${
                        isRecommended
                          ? 'bg-md-primary text-md-on-primary elevation-1 hover:elevation-2'
                          : 'hover:elevation-1'
                      }`}
                      variant={isRecommended ? 'default' : 'secondary'}
                      onClick={() =>
                        router.push(
                          `/portal/login?redirect=${encodeURIComponent('/portal/plans')}`,
                        )
                      }
                      aria-label={`${t('loginToBuy')} · ${plan.name}`}
                    >
                      {t('loginToBuy')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 购买确认对话框 */}
      <AlertDialog
        open={!!confirmPlan}
        onOpenChange={(open) => {
          if (!open && buyingId === null) setConfirmPlan(null);
        }}
      >
        <AlertDialogContent pending={buyingId !== null}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmPurchase')}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmPlan
                ? t('confirmPurchaseDesc', {
                    name: confirmPlan.name ?? '',
                    price: formatPrice(confirmPlan.price ?? 0),
                    days: confirmPlan.duration_days ?? 0,
                  })
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={buyingId !== null}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              loading={buyingId !== null}
              loadingLabel={t('buying')}
              onClick={(e) => {
                e.preventDefault();
                if (confirmPlan?.id != null) handleBuy(confirmPlan.id);
              }}
            >
              {t('confirmPurchaseAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 购买失败对话框 */}
      <AlertDialog
        open={!!buyError}
        onOpenChange={(open) => {
          if (!open) setBuyError('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('purchaseFailed')}</AlertDialogTitle>
            <AlertDialogDescription>{buyError}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setBuyError('')}>
              {t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
