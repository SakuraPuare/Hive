import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { PortalPublicService, PortalService } from '@/src/generated/client';
import type { model_Plan } from '@/src/generated/client/models/model_Plan';
import { useCustomer } from '@/lib/portal-auth';
import { portalSessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Globe, Zap, Shield, ArrowRight, Check, AlertCircle } from 'lucide-react';

type PlansStatus = 'loading' | 'error' | 'ready';

function formatPrice(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

function formatTraffic(bytes: number, unlimited: string) {
  if (!bytes || bytes === 0) return unlimited;
  return `${(bytes / (1024 ** 3)).toFixed(0)} GB`;
}

export default function PortalLandingPage() {
  const t = useTranslations('portal');
  const router = useRouter();
  const toast = useToast();
  const { customer } = useCustomer();
  const [plans, setPlans] = useState<model_Plan[]>([]);
  const [status, setStatus] = useState<PlansStatus>('loading');
  const [buyingId, setBuyingId] = useState<number | null>(null);

  const activeRef = React.useRef(true);
  const loadPlans = React.useCallback(async () => {
    setStatus('loading');
    try {
      const data = await PortalPublicService.portalPlans();
      if (!activeRef.current) return;
      const list = Array.isArray(data) ? data : [];
      setPlans(list.filter((p) => p.enabled).slice(0, 3));
      setStatus('ready');
    } catch {
      if (!activeRef.current) return;
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    loadPlans();
    return () => {
      activeRef.current = false;
    };
  }, [loadPlans]);

  // Buy: route by auth state. Logged-out → register pre-selecting the plan;
  // logged-in → create the order directly, then land on orders.
  async function handleBuy(planId?: number) {
    if (planId == null) return;
    if (!customer) {
      router.push(`/portal/register?plan=${planId}`);
      return;
    }
    setBuyingId(planId);
    try {
      await portalSessionApi(PortalService.portalCreateOrder({ requestBody: { plan_id: planId } }));
      toast.success(t('orderCreated'));
      router.push('/portal/orders');
    } catch (e) {
      toast.error(getErrorMessage(e, t('buyFailed')));
    } finally {
      setBuyingId(null);
    }
  }

  const features = [
    { icon: Zap, title: t('feature1Title'), desc: t('feature1Desc') },
    { icon: Shield, title: t('feature2Title'), desc: t('feature2Desc') },
    { icon: Globe, title: t('feature3Title'), desc: t('feature3Desc') },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/80 backdrop-blur-md px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-md-primary-container text-md-on-primary-container">
            <Globe className="h-5 w-5" aria-hidden="true" />
          </div>
          <span className="font-display text-base font-600 tracking-tight">{t('brand')}</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {/* Login: text link on mobile, ghost button on desktop, to ease narrow-header crowding */}
          <Button asChild type="button" variant="ghost" className="hidden sm:inline-flex">
            <Link href="/portal/login">{t('login')}</Link>
          </Button>
          <Button
            asChild
            type="button"
            variant="default"
            className="state-layer ripple rounded-lg bg-md-primary text-md-on-primary elevation-1 hover:elevation-2 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:outline-none transition-shadow"
          >
            <Link href="/portal/register">{t('register')}</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="animate-fade-in flex flex-col items-center px-6 py-24 text-center bg-md-surface-container-low border-b">
        {/* Tonal accent strip above headline */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-md-primary-container px-4 py-1.5 text-xs font-500 text-md-on-primary-container">
          <span className="size-1.5 rounded-full bg-md-primary" aria-hidden="true" />
          {t('brand')}
        </div>
        <h1 className="font-display max-w-3xl text-4xl font-700 tracking-tight text-foreground sm:text-5xl">
          {t('landingHeadline')}
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
          {t('landingSub')}
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Button
            asChild
            type="button"
            size="lg"
            className="state-layer ripple rounded-lg bg-md-primary text-md-on-primary elevation-1 hover:elevation-2 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:outline-none transition-shadow"
          >
            <Link href="/portal/register">
              {t('getStarted')}
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            asChild
            type="button"
            size="lg"
            variant="outline"
            className="state-layer rounded-lg border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <Link href="/portal/plans">{t('viewPlans')}</Link>
          </Button>
        </div>
      </section>

      {/* Plans preview — three-state (loading / error / ready), announced via aria-live */}
      <section className="px-6 py-16 bg-background" aria-live="polite" aria-busy={status === 'loading'}>
        <div className="mx-auto max-w-5xl">
          <h2 className="font-display mb-10 text-center text-2xl font-600 tracking-tight text-foreground">
            {t('viewPlans')}
          </h2>

          {status === 'loading' && (
            <div className="grid gap-6 sm:grid-cols-3" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="flex flex-col rounded-xl border bg-card elevation-1">
                  <CardContent className="flex flex-1 flex-col gap-5 p-6">
                    <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
                    <div className="h-8 w-1/2 animate-pulse rounded bg-muted" />
                    <div className="flex flex-col gap-2.5">
                      <div className="h-4 w-full animate-pulse rounded bg-muted" />
                      <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
                    </div>
                    <div className="mt-auto h-11 w-full animate-pulse rounded-lg bg-muted" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {status === 'error' && (
            <div
              role="alert"
              className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl bg-md-error-container px-6 py-8 text-center"
            >
              <div className="flex items-center gap-2 text-md-on-error-container">
                <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
                <p className="text-sm font-500">{t('plansLoadError')}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={loadPlans}
                className="state-layer rounded-lg focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                {t('retry')}
              </Button>
            </div>
          )}

          {status === 'ready' && plans.length === 0 && (
            <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border bg-md-surface-container-low px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground">{t('noPlansAvailable')}</p>
              <Button
                asChild
                type="button"
                variant="outline"
                className="state-layer rounded-lg focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:outline-none"
              >
                <Link href="/portal/plans">{t('viewPlans')}</Link>
              </Button>
            </div>
          )}

          {status === 'ready' && plans.length > 0 && (
            <div className="grid gap-6 sm:grid-cols-3">
              {plans.map((plan, idx) => (
                <div
                  key={plan.id ?? idx}
                  className="animate-slide-up"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <Card
                    className={[
                      'relative flex flex-col rounded-xl border transition-shadow',
                      idx === 1
                        ? 'bg-md-primary-container border-md-primary/30 elevation-2'
                        : 'bg-card elevation-1 hover:elevation-2',
                    ].join(' ')}
                  >
                    {idx === 1 && (
                      <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-md-primary px-3 py-1 text-xs font-500 text-md-on-primary elevation-1">
                        <span className="size-1.5 rounded-full bg-md-on-primary/60" aria-hidden="true" />
                        {t('recommended')}
                      </span>
                    )}
                    <CardContent className="flex flex-1 flex-col gap-5 p-6">
                      <h3
                        className={[
                          'font-display text-lg font-600',
                          idx === 1 ? 'text-md-on-primary-container' : 'text-foreground',
                        ].join(' ')}
                      >
                        {plan.name}
                      </h3>
                      <div className="flex items-baseline gap-1">
                        <span
                          className={[
                            'font-display text-3xl font-700',
                            idx === 1 ? 'text-md-on-primary-container' : 'text-foreground',
                          ].join(' ')}
                        >
                          {formatPrice(plan.price ?? 0)}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          / {plan.duration_days ?? 0} {t('days')}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
                        <li className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-md-tertiary-container">
                            <Check className="h-3 w-3 text-md-on-tertiary-container" aria-hidden="true" />
                          </span>
                          {formatTraffic(plan.traffic_limit ?? 0, t('unlimited'))}
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-md-tertiary-container">
                            <Check className="h-3 w-3 text-md-on-tertiary-container" aria-hidden="true" />
                          </span>
                          {plan.device_limit ?? 0}
                        </li>
                      </ul>
                      <Button
                        type="button"
                        loading={buyingId === plan.id}
                        onClick={() => handleBuy(plan.id)}
                        className={[
                          'state-layer ripple mt-auto w-full rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none transition-shadow',
                          idx === 1
                            ? 'bg-md-primary text-md-on-primary elevation-1 hover:elevation-2 focus-visible:ring-md-primary'
                            : 'bg-md-secondary-container text-md-on-secondary-container focus-visible:ring-md-primary',
                        ].join(' ')}
                      >
                        {t('buy')}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Features */}
      <section className="bg-md-surface-container-low border-t px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="font-display mb-12 text-center text-2xl font-600 tracking-tight text-foreground">
            {t('featuresTitle')}
          </h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {features.map((f, idx) => {
              const Icon = f.icon;
              return (
                <div
                  key={idx}
                  className="animate-slide-up"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <Card className="bg-card border rounded-xl hover:elevation-1 transition-shadow">
                    <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-md-secondary-container text-md-on-secondary-container">
                        <Icon className="h-6 w-6" aria-hidden="true" />
                      </div>
                      <h3 className="font-display text-base font-600 text-foreground">{f.title}</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto flex flex-col items-center gap-2 border-t bg-md-surface-container-low px-6 py-8 text-center">
        <p className="text-sm text-muted-foreground">{t('footerText')}</p>
        <Link
          href="/login"
          aria-label={t('adminEntryHint')}
          className="state-layer inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {t('adminEntry')}
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </footer>
    </div>
  );
}
