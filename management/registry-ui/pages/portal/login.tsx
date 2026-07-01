import React, { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { portalLogin } from '@/lib/portal-auth';
import { getErrorMessage } from '@/lib/i18n';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Globe, ArrowRight } from 'lucide-react';

export default function PortalLoginPage() {
  const t = useTranslations('portal');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left panel — branding, M3 primary-container surface */}
      <div className="hidden lg:flex lg:w-1/2 bg-md-primary-container relative overflow-hidden">
        {/* Subtle dot pattern using on-primary-container at low opacity */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle, hsl(var(--md-on-primary-container)) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        {/* Soft radial highlight bottom-right */}
        <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full bg-md-primary/20 blur-3xl" />

        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20">
          {/* Brand mark */}
          <div
            className="flex items-center gap-3 mb-10 animate-slide-up"
            style={{ animationDelay: '0ms' }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-md-primary elevation-1">
              <Globe className="h-6 w-6 text-md-on-primary" aria-hidden="true" />
            </div>
            <span className="font-display text-2xl font-600 text-md-on-primary-container tracking-tight">
              {t('brand')}
            </span>
          </div>

          {/* Hero copy */}
          <h1
            className="font-display text-4xl font-700 text-md-on-primary-container leading-tight mb-4 animate-slide-up"
            style={{ animationDelay: '60ms' }}
          >
            {t('heroTitle') || 'Secure. Fast.\nUnlimited.'}
          </h1>
          <p
            className="text-base leading-relaxed text-md-on-primary-container/70 max-w-sm animate-slide-up"
            style={{ animationDelay: '120ms' }}
          >
            {t('heroDesc') || 'Premium proxy service with global coverage and blazing fast connections.'}
          </p>

          {/* Decorative divider */}
          <div
            className="mt-12 flex items-center gap-3 animate-slide-up"
            style={{ animationDelay: '180ms' }}
          >
            <div className="h-px flex-1 bg-md-on-primary-container/20" />
            <span className="text-xs font-500 text-md-on-primary-container/50 uppercase tracking-widest">
              Hive
            </span>
            <div className="h-px flex-1 bg-md-on-primary-container/20" />
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <main className="flex w-full lg:w-1/2 items-center justify-center p-6 bg-background">
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div
            className="flex items-center gap-2.5 mb-10 lg:hidden animate-slide-up"
            style={{ animationDelay: '0ms' }}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-md-primary elevation-1">
              <Globe className="h-5 w-5 text-md-on-primary" aria-hidden="true" />
            </div>
            <span className="font-display text-xl font-600 tracking-tight text-foreground">
              {t('brand')}
            </span>
          </div>

          {/* Heading block */}
          <div
            className="mb-8 animate-slide-up"
            style={{ animationDelay: '40ms' }}
          >
            <h2 className="font-display text-2xl font-700 tracking-tight text-foreground">
              {t('customerLogin')}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('noAccount')}{' '}
              <Link
                href="/portal/register"
                className="font-500 text-md-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary rounded-sm"
              >
                {t('goRegister')}
              </Link>
            </p>
          </div>

          {/* react-doctor-disable-next-line react-doctor/no-prevent-default -- static-export SPA against a Go API; server actions are not available */}
          <form
            noValidate
            aria-busy={loading}
            aria-label={t('customerLogin')}
            onSubmit={async (e) => {
              e.preventDefault();
              setLoading(true);
              setError('');
              try {
                await portalLogin(email, password);
                window.location.replace('/portal/dashboard');
              } catch (e) {
                setError(getErrorMessage(e, t('loginFailed')));
              } finally {
                setLoading(false);
              }
            }}
          >
            <div className="space-y-5">
              {/* Email field */}
              <div
                className="space-y-2 animate-slide-up"
                style={{ animationDelay: '80ms' }}
              >
                <Label htmlFor="email" className="text-sm font-500 text-foreground">
                  {t('email')}
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  className="h-11 rounded-lg bg-md-surface-container-high border-border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-0 focus-visible:border-md-primary transition-colors"
                />
              </div>

              {/* Password field */}
              <div
                className="space-y-2 animate-slide-up"
                style={{ animationDelay: '120ms' }}
              >
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-500 text-foreground">
                    {t('password')}
                  </Label>
                  <Link
                    href="/portal/forgot-password"
                    className="-mx-2 -my-1.5 inline-flex items-center px-2 py-1.5 text-xs font-500 text-md-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary rounded-lg"
                  >
                    {t('forgotPassword')}
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  passwordToggleLabel={t('togglePassword')}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  className="h-11 rounded-lg bg-md-surface-container-high border-border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-0 focus-visible:border-md-primary transition-colors"
                />
              </div>

              {/* Error banner */}
              {error && (
                <div
                  id="login-error"
                  role="alert"
                  aria-live="assertive"
                  aria-atomic="true"
                  className="flex items-start gap-3 rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container"
                >
                  <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-md-error" aria-hidden="true" />
                  {error}
                </div>
              )}

              {/* Submit */}
              <div
                className="animate-slide-up"
                style={{ animationDelay: '160ms' }}
              >
                <Button
                  type="submit"
                  size="lg"
                  loading={loading}
                  aria-label={loading ? t('loggingIn') : undefined}
                  className="w-full h-11"
                >
                  {loading ? (
                    t('loggingIn')
                  ) : (
                    <>
                      {t('login')}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
