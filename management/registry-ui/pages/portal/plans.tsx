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

function formatTraffic(bytes: number, t: any) {
  if (bytes === 0) return t('unlimited');
  return `${(bytes / (1024 ** 3)).toFixed(1)} ${t('gb')}`;
}

function formatPrice(cents: number, t: any) {
  return `${(cents / 100).toFixed(2)} ${t('yuan')}`;
}

export default function PortalPlansPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [plans, setPlans] = useState<model_Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
    try {
      await portalSessionApi(PortalService.portalCreateOrder({ requestBody: { plan_id: planId } }));
      router.push('/portal/orders');
    } catch (e: any) {
      alert(e?.error || t('loadFailed'));
    }
  }

  if (loading) return <p className="p-6 text-sm text-muted-foreground">{tCommon('loading')}</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t('plansTitle')}</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.filter((p) => p.enabled).map((plan) => (
          <Card key={plan.id} className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-lg">{plan.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('traffic')}</span>
                  <span className="font-medium">{formatTraffic(plan.traffic_limit ?? 0, t)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('duration')}</span>
                  <span className="font-medium">{t('durationDays', { days: plan.duration_days ?? 0 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('deviceLimit')}</span>
                  <span className="font-medium">{plan.device_limit} {t('devices')}</span>
                </div>
              </div>
              <div className="pt-2">
                <p className="text-2xl font-bold mb-3">{formatPrice(plan.price ?? 0, t)}</p>
                <Button className="w-full" onClick={() => handleBuy(plan.id!)}>
                  {t('buy')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
