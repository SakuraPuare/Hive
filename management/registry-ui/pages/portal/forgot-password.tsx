import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { PortalAuthService } from '@/src/generated/client';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Globe, ArrowRight, Loader2, Mail } from 'lucide-react';

export default function PortalForgotPasswordPage() {
  const t = useTranslations('portal');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/* Left panel — branding (M3 surface container, no legacy gradient) */}
      <div className="hidden lg:flex lg:w-1/2 bg-md-primary-container relative overflow-hidden">
        {/* Subtle dot texture using on-primary-container tint */}
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle, hsl(var(--md-on-primary-container)) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20">
          <div className="flex items-center gap-3 mb-8 animate-slide-up" style={{ animationDelay: '0ms' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-md-primary/20">
              <Globe className="h-7 w-7 text-md-on-primary-container" />
            </div>
            <span className="font-display text-2xl font-600 text-md-on-primary-container tracking-tight">{t('brand')}</span>
          </div>
          <h1 className="font-display text-4xl font-700 text-md-on-primary-container leading-tight mb-4 animate-slide-up" style={{ animationDelay: '60ms' }}>{t('heroTitle')}</h1>
          <p className="text-base text-md-on-primary-container/70 max-w-md leading-relaxed animate-slide-up" style={{ animationDelay: '120ms' }}>{t('heroDesc')}</p>
        </div>
      </div>

      {/* Right panel — form / success */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-6 bg-background">
        <div className="w-full max-w-[400px] animate-fade-in">
          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-md-primary-container">
              <Globe className="h-5 w-5 text-md-on-primary-container" />
            </div>
            <span className="font-display text-xl font-600 tracking-tight">{t('brand')}</span>
          </div>

          {sent ? (
            <div className="text-center animate-slide-up">
              {/* Success icon — M3 tertiary container (success role per §10) */}
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-md-tertiary-container">
                <svg
                  className="h-8 w-8 text-md-on-tertiary-container"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
              <h2 className="font-display text-2xl font-600 tracking-tight">{t('codeSent')}</h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t('codeSentDesc')}</p>
              <Button
                type="button"
                className="state-layer ripple w-full h-11 text-sm font-500 mt-8 rounded-lg bg-md-primary text-md-on-primary elevation-1 hover:elevation-2 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
                onClick={() => router.push('/portal/reset-password')}
              >
                {t('goReset')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
              <p className="mt-6 text-center text-sm text-muted-foreground">
                <Link href="/portal/login" className="font-500 text-md-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary rounded-sm">
                  {t('backToLogin')}
                </Link>
              </p>
            </div>
          ) : (
            <>
              <div className="mb-8 animate-slide-up" style={{ animationDelay: '0ms' }}>
                <h2 className="font-display text-2xl font-600 tracking-tight">{t('forgotTitle')}</h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t('forgotDesc')}</p>
              </div>

              {/* react-doctor-disable-next-line react-doctor/no-prevent-default -- static-export SPA against a Go API; server actions are not available */}
              <form
                className="animate-slide-up"
                style={{ animationDelay: '60ms' }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLoading(true);
                  setError('');
                  try {
                    await PortalAuthService.portalForgotPassword({ requestBody: { email } });
                    setSent(true);
                  } catch (e) {
                    setError(getErrorMessage(e, t('sendCodeFailed')));
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-500 text-foreground">{t('email')}</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        required
                        className="h-11 pl-10 rounded-lg bg-md-surface-container-high border-input focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-0"
                      />
                    </div>
                  </div>
                  {error && (
                    <div className="rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container">
                      {error}
                    </div>
                  )}
                  <Button
                    type="submit"
                    className="state-layer ripple w-full h-11 text-sm font-500 rounded-lg bg-md-primary text-md-on-primary elevation-1 hover:elevation-2 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        {t('sendCode')}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </form>

              <p className="mt-6 text-center text-sm text-muted-foreground animate-slide-up" style={{ animationDelay: '120ms' }}>
                <Link href="/portal/login" className="font-500 text-md-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary rounded-sm">
                  {t('backToLogin')}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
