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
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="gradient-brand flex h-9 w-9 items-center justify-center rounded-full">
            <Globe className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold">{t('brand')}</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild type="button" variant="ghost">
            <Link href="/portal/login">{t('login')}</Link>
          </Button>
          <Button asChild type="button" variant="default">
            <Link href="/portal/register">{t('register')}</Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="gradient-brand-subtle animate-fade-in flex flex-col items-center px-6 py-24 text-center">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-primary sm:text-5xl">
          {t('landingHeadline')}
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">{t('landingSub')}</p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Button asChild type="button" size="lg">
            <Link href="/portal/register">
              {t('getStarted')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button asChild type="button" size="lg" variant="outline">
            <Link href="/portal/plans">{t('viewPlans')}</Link>
          </Button>
        </div>
      </section>

      {/* Plans preview */}
      {plans.length > 0 && (
        <section className="px-6 py-16">
          <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-3">
            {plans.map((plan, idx) => (
              <Card key={plan.id ?? idx} className="relative flex flex-col shadow-xs">
                {idx === 1 && (
                  <span className="gradient-brand absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-medium text-primary-foreground">
                    {t('recommended')}
                  </span>
                )}
                <CardContent className="flex flex-1 flex-col gap-4 p-6">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-primary">
                      {formatPrice(plan.price ?? 0)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      / {plan.duration_days ?? 0} {t('days')}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      {formatTraffic(plan.traffic_limit ?? 0, t('unlimited'))}
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      {plan.device_limit ?? 0}
                    </li>
                  </ul>
                  <Button asChild type="button" className="mt-auto w-full">
                    <Link href="/portal/login">{t('buy')}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Features */}
      <section className="bg-muted px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-12 text-center text-2xl font-semibold">{t('featuresTitle')}</h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {features.map((f, idx) => {
              const Icon = f.icon;
              return (
                <Card key={idx} className="shadow-xs">
                  <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                    <div className="gradient-brand flex h-12 w-12 items-center justify-center rounded-full">
                      <Icon className="h-6 w-6 text-primary-foreground" />
                    </div>
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="text-sm text-muted-foreground">{f.desc}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto flex flex-col items-center gap-2 border-t px-6 py-8 text-center">
        <p className="text-sm text-muted-foreground">{t('footerText')}</p>
        <Link href="/login" className="text-xs text-muted-foreground hover:text-foreground">
          {t('adminEntry')}
        </Link>
      </footer>
    </div>
  );
}
