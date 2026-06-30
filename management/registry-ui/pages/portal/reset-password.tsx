import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { PortalAuthService } from '@/src/generated/client';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Globe, ArrowRight, KeyRound } from 'lucide-react';

export default function PortalResetPasswordPage() {
  const t = useTranslations('portal');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const q = router.query.email;
    if (typeof q === 'string') setEmail(q);
  }, [router.query.email]);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left panel — branding (M3 surface-container, no old gradient) */}
      <div className="hidden lg:flex lg:w-1/2 bg-md-primary-container relative overflow-hidden">
        {/* Subtle tonal dot pattern — on-primary-container at low opacity */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle, hsl(var(--md-on-primary-container)) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20">
          <div className="flex items-center gap-3 mb-10 animate-slide-up" style={{ animationDelay: '0ms' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-md-primary/20">
              <Globe className="h-7 w-7 text-md-on-primary-container" />
            </div>
            <span className="font-display text-2xl font-600 text-md-on-primary-container tracking-tight">
              {t('brand')}
            </span>
          </div>
          <h1
            className="font-display text-4xl font-700 text-md-on-primary-container leading-tight mb-4 animate-slide-up"
            style={{ animationDelay: '60ms' }}
          >
            {t('heroTitle')}
          </h1>
          <p
            className="text-base text-md-on-primary-container/70 max-w-md leading-relaxed animate-slide-up"
            style={{ animationDelay: '120ms' }}
          >
            {t('heroDesc')}
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-6 bg-background">
        <div className="w-full max-w-[400px] animate-fade-in">
          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-md-primary-container">
              <Globe className="h-5 w-5 text-md-on-primary-container" />
            </div>
            <span className="font-display text-xl font-600 tracking-tight text-foreground">{t('brand')}</span>
          </div>

          {done ? (
            /* ── Success state ── */
            <div className="text-center animate-slide-up">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-md-tertiary-container">
                <KeyRound className="h-8 w-8 text-md-on-tertiary-container" />
              </div>
              <h2 className="font-display text-2xl font-600 tracking-tight text-foreground">{t('resetSuccess')}</h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t('resetSuccessDesc')}</p>
              <Button
                asChild
                className="mt-8 w-full h-11 text-sm font-500 state-layer ripple rounded-lg bg-md-primary text-md-on-primary elevation-1 hover:elevation-2 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 transition-shadow"
              >
                <Link href="/portal/login">
                  {t('goLogin')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          ) : (
            <>
              {/* ── Form header ── */}
              <div className="mb-8 animate-slide-up" style={{ animationDelay: '0ms' }}>
                <h2 className="font-display text-2xl font-600 tracking-tight text-foreground">{t('resetTitle')}</h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t('resetDesc')}</p>
              </div>

              {/* react-doctor-disable-next-line react-doctor/no-prevent-default -- static-export SPA against a Go API; server actions are not available */}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLoading(true);
                  setError('');
                  try {
                    await PortalAuthService.portalResetPassword({
                      requestBody: { email, code, password },
                    });
                    setDone(true);
                  } catch (e) {
                    setError(getErrorMessage(e, t('resetFailedMsg')));
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <div className="space-y-5">
                  {/* Email field */}
                  <div className="space-y-1.5 animate-slide-up" style={{ animationDelay: '40ms' }}>
                    <Label htmlFor="email" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                      {t('email')}
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                      className="h-11 rounded-lg bg-md-surface-container-high border-border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-0 focus-visible:border-transparent"
                    />
                  </div>

                  {/* Verify code field */}
                  <div className="space-y-1.5 animate-slide-up" style={{ animationDelay: '80ms' }}>
                    <Label htmlFor="code" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                      {t('verifyCode')}
                    </Label>
                    <Input
                      id="code"
                      type="text"
                      placeholder={t('codePlaceholder')}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                      className="h-11 rounded-lg bg-md-surface-container-high border-border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-0 focus-visible:border-transparent"
                    />
                  </div>

                  {/* New password field */}
                  <div className="space-y-1.5 animate-slide-up" style={{ animationDelay: '120ms' }}>
                    <Label htmlFor="password" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                      {t('newPassword')}
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                      className="h-11 rounded-lg bg-md-surface-container-high border-border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-0 focus-visible:border-transparent"
                    />
                  </div>

                  {/* Error banner */}
                  {error && (
                    <div className="rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container animate-slide-up">
                      {error}
                    </div>
                  )}

                  {/* Submit */}
                  <div className="animate-slide-up pt-1" style={{ animationDelay: '160ms' }}>
                    <Button
                      type="submit"
                      className="w-full h-11 text-sm font-500 state-layer ripple rounded-lg bg-md-primary text-md-on-primary elevation-1 hover:elevation-2 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 transition-shadow"
                      disabled={loading}
                    >
                      {loading ? (
                        /* M3 circular progress — thin ring spinner */
                        <span
                          className="inline-block h-5 w-5 rounded-full border-2 border-md-on-primary/30 border-t-md-on-primary animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <>
                          {t('doReset')}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>

                  <p className="text-center text-sm text-muted-foreground animate-slide-up" style={{ animationDelay: '200ms' }}>
                    <Link
                      href="/portal/login"
                      className="font-500 text-md-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary rounded-sm"
                    >
                      {t('backToLogin')}
                    </Link>
                  </p>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
