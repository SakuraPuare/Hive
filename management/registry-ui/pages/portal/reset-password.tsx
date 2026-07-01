import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { PortalAuthService } from '@/src/generated/client';
import { getErrorMessage } from '@/lib/i18n';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Globe, ArrowRight, KeyRound, AlertCircle } from 'lucide-react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const RESEND_COOLDOWN = 60;

export default function PortalResetPasswordPage() {
  const t = useTranslations('portal');
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [resending, setResending] = useState(false);
  // cooldown > 0 only after the user has explicitly triggered a send.
  const [cooldown, setCooldown] = useState(0);
  // hasSent tracks whether the user has triggered at least one code send
  // (used to gate the Resend button so it's not clickable before first send).
  const [hasSent, setHasSent] = useState(false);

  useEffect(() => {
    const q = router.query.email;
    if (typeof q === 'string') {
      setEmail(q);
      // Email already known from the query param — jump focus to the code
      // field so returning users skip a redundant Tab.
      // useEffect fires after mount so the element is guaranteed to exist.
      if (EMAIL_RE.test(q)) {
        document.getElementById('code')?.focus();
      }
    }
  }, [router.query.email]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const validateEmail = (value: string) => {
    if (!EMAIL_RE.test(value.trim())) {
      setEmailError(t('emailInvalid'));
      return false;
    }
    setEmailError('');
    return true;
  };

  const validatePassword = (value: string) => {
    if (value.length < MIN_PASSWORD_LEN) {
      setPasswordError(t('passwordTooShort'));
      return false;
    }
    setPasswordError('');
    return true;
  };

  const handleResend = async () => {
    if (!validateEmail(email) || cooldown > 0 || resending) return;
    setResending(true);
    try {
      await PortalAuthService.portalForgotPassword({ requestBody: { email } });
      toast.success(t('codeSent'));
      setCooldown(RESEND_COOLDOWN);
      setHasSent(true);
    } catch (e) {
      toast.error(getErrorMessage(e, t('sendCodeFailed')));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Skip link — keyboard users bypass branding panel (WCAG 2.4.1) */}
      <a
        href="#reset-password-form"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-md-primary focus:px-4 focus:py-2 focus:text-md-on-primary"
      >
        {t('skipToContent')}
      </a>
      {/* Left panel — branding (M3 surface-container, no old gradient) */}
      <div className="hidden lg:flex lg:w-1/2 bg-md-primary-container relative overflow-hidden">
        {/* Subtle tonal dot pattern — on-primary-container at low opacity; unified to 0.08 across auth pages */}
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'radial-gradient(circle, hsl(var(--md-on-primary-container)) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20">
          <div className="flex items-center gap-3 mb-10 animate-slide-up motion-reduce:animate-none" style={{ animationDelay: '0ms' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-md-primary/20">
              <Globe className="h-7 w-7 text-md-on-primary-container" aria-hidden="true" />
            </div>
            <span className="font-display text-2xl font-600 text-md-on-primary-container tracking-tight">
              {t('brand')}
            </span>
          </div>
          <h1
            className="font-display text-4xl font-700 text-md-on-primary-container leading-tight mb-4 animate-slide-up motion-reduce:animate-none"
            style={{ animationDelay: '60ms' }}
          >
            {t('heroTitle')}
          </h1>
          <p
            className="text-base text-md-on-primary-container/70 max-w-md leading-relaxed animate-slide-up motion-reduce:animate-none"
            style={{ animationDelay: '120ms' }}
          >
            {t('heroDesc')}
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <main id="reset-password-form" tabIndex={-1} className="flex w-full lg:w-1/2 items-center justify-center p-6 bg-background">
        <div className="w-full max-w-[400px] animate-fade-in motion-reduce:animate-none">
          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-md-primary-container">
              <Globe className="h-5 w-5 text-md-on-primary-container" aria-hidden="true" />
            </div>
            <span className="font-display text-xl font-600 tracking-tight text-foreground">{t('brand')}</span>
          </div>

          {done ? (
            /* ── Success state ── */
            <div className="text-center animate-slide-up motion-reduce:animate-none">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-md-tertiary-container">
                <KeyRound className="h-8 w-8 text-md-on-tertiary-container" aria-hidden="true" />
              </div>
              <h2 className="font-display text-2xl font-600 tracking-tight text-foreground">{t('resetSuccess')}</h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t('resetSuccessDesc')}</p>
              <Button
                asChild
                size="lg"
                className="mt-8 w-full"
              >
                <Link href="/portal/login">
                  {t('goLogin')}
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          ) : (
            <>
              {/* ── Form header ── */}
              <div className="mb-8 animate-slide-up motion-reduce:animate-none" style={{ animationDelay: '0ms' }}>
                <h2 className="font-display text-2xl font-600 tracking-tight text-foreground">{t('resetTitle')}</h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t('resetDesc')}</p>
              </div>

              {/* react-doctor-disable-next-line react-doctor/no-prevent-default -- static-export SPA against a Go API; server actions are not available */}
              <form
                noValidate
                aria-label={t('resetTitle')}
                aria-busy={loading}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const okEmail = validateEmail(email);
                  const okPassword = validatePassword(password);
                  const okCode = /^[0-9]{6}$/.test(code.trim());
                  if (!okCode) setCodeError(t('codeInvalidFormat'));
                  else setCodeError('');
                  if (!okEmail || !okPassword || !okCode) {
                    setError('');
                    return;
                  }
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
                  <div className="space-y-1.5 animate-slide-up motion-reduce:animate-none" style={{ animationDelay: '40ms' }}>
                    <Label htmlFor="email" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                      {t('email')}
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        // Email changed → the code may belong to a different
                        // address; clear it to avoid mismatched submits.
                        if (code) setCode('');
                        if (emailError) setEmailError('');
                      }}
                      onBlur={(e) => e.target.value && validateEmail(e.target.value)}
                      autoComplete="email"
                      required
                      aria-required="true"
                      error={emailError || undefined}
                    />
                  </div>

                  {/* Verify code field */}
                  <div className="space-y-1.5 animate-slide-up motion-reduce:animate-none" style={{ animationDelay: '80ms' }}>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="code" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                        {t('verifyCode')}
                      </Label>
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        className="h-auto px-0 text-xs"
                        onClick={handleResend}
                        loading={resending}
                        disabled={cooldown > 0 || (!hasSent && !EMAIL_RE.test(email.trim()))}
                      >
                        {cooldown > 0 ? t('resendCodeIn', { seconds: cooldown }) : hasSent ? t('resendCode') : t('sendCode')}
                      </Button>
                    </div>
                    <Input
                      id="code"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      pattern="[0-9]{6}"
                      autoComplete="one-time-code"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={t('codePlaceholder')}
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value);
                        if (codeError) setCodeError('');
                      }}
                      required
                      aria-required="true"
                      error={codeError || undefined}
                      helperText={codeError ? undefined : t('codeHint')}
                    />
                  </div>

                  {/* New password field */}
                  <div className="space-y-1.5 animate-slide-up motion-reduce:animate-none" style={{ animationDelay: '120ms' }}>
                    <Label htmlFor="password" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                      {t('newPassword')}
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (passwordError) setPasswordError('');
                      }}
                      onBlur={(e) => e.target.value && validatePassword(e.target.value)}
                      autoComplete="new-password"
                      required
                      aria-required="true"
                      minLength={MIN_PASSWORD_LEN}
                      passwordToggleLabel={t('togglePassword')}
                      error={passwordError || undefined}
                      helperText={passwordError ? undefined : t('passwordHint')}
                    />
                  </div>

                  {/* Error banner — global fallback, assertive for AT */}
                  {error && (
                    <div
                      role="alert"
                      aria-live="assertive"
                      className="flex items-start gap-2 rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container animate-slide-up motion-reduce:animate-none"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{error}</span>
                    </div>
                  )}

                  {/* Submit */}
                  <div className="animate-slide-up motion-reduce:animate-none pt-1" style={{ animationDelay: '160ms' }}>
                    <Button
                      type="submit"
                      size="lg"
                      className="w-full"
                      loading={loading}
                    >
                      {loading ? t('submitting') : t('doReset')}
                      {!loading && <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />}
                    </Button>
                  </div>

                  <p className="text-center text-sm text-muted-foreground animate-slide-up motion-reduce:animate-none" style={{ animationDelay: '200ms' }}>
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
      </main>
    </div>
  );
}
