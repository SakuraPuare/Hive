import React from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useCustomer, portalLogout } from '@/lib/portal-auth';
import { User, Mail, Calendar, Shield, LogOut } from 'lucide-react';

function initial(nickname?: string, email?: string) {
  const src = (nickname || email || '?').trim();
  return src.charAt(0).toUpperCase();
}

export default function PortalAccountPage() {
  const t = useTranslations('portal');
  const router = useRouter();
  const { customer, loading } = useCustomer();

  React.useEffect(() => {
    if (!loading && !customer) router.replace('/portal/login');
  }, [loading, customer, router]);

  async function handleLogout() {
    await portalLogout();
    window.location.href = '/portal/login';
  }

  if (loading || !customer) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-32">
        {/* M3 circular progress — primary ring */}
        <div
          className="h-10 w-10 rounded-full border-[3px] border-md-primary-container border-t-md-primary animate-spin"
          style={{ animationDuration: '0.9s' }}
        />
        <p className="text-sm text-muted-foreground animate-fade-in">{t('loading')}</p>
      </div>
    );
  }

  const status = customer.status ?? '';
  const created = customer.created_at ? new Date(customer.created_at).toLocaleString() : '-';

  return (
    <div className="space-y-5">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between animate-slide-up">
        <h1 className="font-display text-2xl font-600 tracking-tight text-foreground">
          {t('accountTitle')}
        </h1>
        {/* Tonal outlined button — destructive intent */}
        <button
          type="button"
          onClick={handleLogout}
          className="state-layer ripple inline-flex items-center gap-2 rounded-lg border border-md-outline-variant
            px-4 py-2 text-sm font-500 text-destructive
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
            transition-colors"
          style={{ '--state-color': 'hsl(var(--md-error))' } as React.CSSProperties}
        >
          <LogOut className="h-4 w-4" />
          <span>{t('logout')}</span>
        </button>
      </div>

      {/* ── Profile hero card ── */}
      <div
        className="bg-card border rounded-xl p-6 animate-slide-up"
        style={{ animationDelay: '40ms' }}
      >
        <div className="flex items-center gap-5">
          {/* Avatar — primary-container tonal circle */}
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full
              bg-md-primary-container text-md-on-primary-container
              font-display text-2xl font-700 elevation-1 select-none"
          >
            {initial(customer.nickname, customer.email)}
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="font-display text-xl font-600 text-foreground truncate">
              {customer.nickname || '-'}
            </p>
            <p className="text-sm text-muted-foreground truncate">{customer.email}</p>
          </div>
        </div>
      </div>

      {/* ── Account info card ── */}
      <div
        className="bg-card border rounded-xl overflow-hidden animate-slide-up"
        style={{ animationDelay: '80ms' }}
      >
        {/* Section label */}
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-xs font-500 text-muted-foreground uppercase tracking-wider">
            {t('accountInfo')}
          </h2>
        </div>

        <dl className="grid grid-cols-1 gap-px sm:grid-cols-2 bg-border">
          {/* Email */}
          <div
            className="bg-card px-6 py-4 space-y-1 animate-slide-up"
            style={{ animationDelay: '120ms' }}
          >
            <dt className="flex items-center gap-2 text-xs font-500 text-muted-foreground uppercase tracking-wide">
              <Mail className="h-3.5 w-3.5" />
              {t('accountEmail')}
            </dt>
            <dd className="text-sm text-foreground">{customer.email}</dd>
          </div>

          {/* Nickname */}
          <div
            className="bg-card px-6 py-4 space-y-1 animate-slide-up"
            style={{ animationDelay: '160ms' }}
          >
            <dt className="flex items-center gap-2 text-xs font-500 text-muted-foreground uppercase tracking-wide">
              <User className="h-3.5 w-3.5" />
              {t('accountNickname')}
            </dt>
            <dd className="text-sm text-foreground">{customer.nickname || '-'}</dd>
          </div>

          {/* Status */}
          <div
            className="bg-card px-6 py-4 space-y-1 animate-slide-up"
            style={{ animationDelay: '200ms' }}
          >
            <dt className="flex items-center gap-2 text-xs font-500 text-muted-foreground uppercase tracking-wide">
              <Shield className="h-3.5 w-3.5" />
              {t('accountStatus')}
            </dt>
            <dd>
              {status === 'banned' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500
                  bg-md-error-container text-md-on-error-container">
                  <span className="size-1.5 rounded-full bg-md-error" />
                  {t('statusBanned')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500
                  bg-md-tertiary-container text-md-on-tertiary-container">
                  <span className="size-1.5 rounded-full bg-md-tertiary" />
                  {t('statusActive')}
                </span>
              )}
            </dd>
          </div>

          {/* Created at */}
          <div
            className="bg-card px-6 py-4 space-y-1 animate-slide-up"
            style={{ animationDelay: '240ms' }}
          >
            <dt className="flex items-center gap-2 text-xs font-500 text-muted-foreground uppercase tracking-wide">
              <Calendar className="h-3.5 w-3.5" />
              {t('accountCreated')}
            </dt>
            <dd className="text-sm text-foreground">{created}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
