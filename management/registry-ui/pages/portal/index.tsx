import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PortalPublicService } from '@/src/generated/client';
import type { model_Plan } from '@/src/generated/client/models/model_Plan';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Globe, Zap, Shield, ArrowRight, Check } from 'lucide-react';

function formatPrice(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

function formatTraffic(bytes: number, unlimited: string) {
  if (!bytes || bytes === 0) return unlimited;
  return `${(bytes / (1024 ** 3)).toFixed(0)} GB`;
}

export default function PortalLandingPage() {
  const t = useTranslations('portal');
  const [plans, setPlans] = useState<model_Plan[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await PortalPublicService.portalPlans();
        if (!active) return;
        const list = Array.isArray(data) ? data : [];
        setPlans(list.filter((p) => p.enabled).slice(0, 3));
      } catch {
        // silent
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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
            <Globe className="h-5 w-5" />
          </div>
          <span className="font-display text-base font-600 tracking-tight">{t('brand')}</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild type="button" variant="ghost">
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
          <span className="size-1.5 rounded-full bg-md-primary" />
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
              <ArrowRight className="ml-2 h-4 w-4" />
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

      {/* Plans preview */}
      {plans.length > 0 && (
        <section className="px-6 py-16 bg-background">
          <div className="mx-auto max-w-5xl">
            <h2 className="font-display mb-10 text-center text-2xl font-600 tracking-tight text-foreground">
              {t('viewPlans')}
            </h2>
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
                        <span className="size-1.5 rounded-full bg-md-on-primary/60" />
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
                            <Check className="h-3 w-3 text-md-on-tertiary-container" />
                          </span>
                          {formatTraffic(plan.traffic_limit ?? 0, t('unlimited'))}
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-md-tertiary-container">
                            <Check className="h-3 w-3 text-md-on-tertiary-container" />
                          </span>
                          {plan.device_limit ?? 0}
                        </li>
                      </ul>
                      <Button
                        asChild
                        type="button"
                        className={[
                          'state-layer ripple mt-auto w-full rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none transition-shadow',
                          idx === 1
                            ? 'bg-md-primary text-md-on-primary elevation-1 hover:elevation-2 focus-visible:ring-md-primary'
                            : 'bg-md-secondary-container text-md-on-secondary-container focus-visible:ring-md-primary',
                        ].join(' ')}
                      >
                        <Link href="/portal/login">{t('buy')}</Link>
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

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
                        <Icon className="h-6 w-6" />
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
          className="state-layer rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1 focus-visible:outline-none"
        >
          {t('adminEntry')}
        </Link>
      </footer>
    </div>
  );
}
