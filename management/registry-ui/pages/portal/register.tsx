import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { portalRegister } from '@/lib/portal-auth';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Globe, ArrowRight, Tag, X } from 'lucide-react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldErrors = {
  email?: string;
  nickname?: string;
  password?: string;
};

export default function PortalRegisterPage() {
  const t = useTranslations('portal');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // 捕获邀请链接中的推荐码 ?ref=CODE
  useEffect(() => {
    const ref = router.query.ref;
    if (typeof ref === 'string' && ref) setReferralCode(ref);
  }, [router.query.ref]);

  // 提交前轻量校验,返回首个出错字段以便定位 focus
  const validate = (): keyof FieldErrors | null => {
    const next: FieldErrors = {};
    if (!EMAIL_RE.test(email)) next.email = t('emailInvalid');
    if (nickname.trim().length < 2 || nickname.trim().length > 20)
      next.nickname = t('nicknameLength');
    if (password.length < 8) next.password = t('passwordTooShort');
    setFieldErrors(next);
    return (['email', 'nickname', 'password'] as const).find((k) => next[k]) ?? null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const firstInvalid = validate();
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    setLoading(true);
    try {
      await portalRegister(email, password, nickname, referralCode);
      setSuccess(true);
      router.replace('/portal/dashboard');
    } catch (err) {
      setError(getErrorMessage(err, t('registerFailed')));
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Left panel — M3 tonal surface branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-md-primary-container">
        {/* Subtle tonal geometry: concentric arcs in on-primary-container at low opacity */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <svg
            width="100%"
            height="100%"
            xmlns="http://www.w3.org/2000/svg"
            className="opacity-[0.07]"
            preserveAspectRatio="xMidYMid slice"
          >
            <defs>
              <radialGradient id="rg" cx="30%" cy="70%" r="80%">
                <stop offset="0%" stopColor="hsl(224 76% 18%)" stopOpacity="1" />
                <stop offset="100%" stopColor="hsl(224 76% 18%)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <rect width="100%" height="100%" fill="url(#rg)" />
            {[160, 260, 380, 520, 680].map((r, i) => (
              <circle
                key={i}
                cx="30%"
                cy="70%"
                r={r}
                fill="none"
                stroke="hsl(224 76% 18%)"
                strokeWidth="1.5"
              />
            ))}
          </svg>
        </div>

        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20">
          {/* Brand mark */}
          <div className="flex items-center gap-3 mb-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-md-primary">
              <Globe className="h-6 w-6 text-md-on-primary" aria-hidden="true" />
            </div>
            <span className="font-display text-2xl font-semibold text-md-on-primary-container tracking-tight">
              {t('brand')}
            </span>
          </div>

          {/* Hero copy */}
          <h1 className="font-display text-4xl font-bold text-md-on-primary-container leading-snug mb-5">
            {t('heroTitle') || 'Secure. Fast.\nUnlimited.'}
          </h1>
          <p className="text-base text-md-on-primary-container/70 max-w-sm leading-relaxed">
            {t('heroDesc') || 'Premium proxy service with global coverage and blazing fast connections.'}
          </p>

          {/* Decorative pill chips at bottom */}
          <div className="mt-14 flex flex-wrap gap-2">
            {['TLS 1.3', 'Zero-log', 'Global PoPs', 'API access'].map((label, i) => (
              <span
                key={label}
                className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium
                  bg-md-primary/20 text-md-on-primary-container animate-slide-up"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex w-full lg:w-1/2 items-center justify-center p-6 bg-background">
        <div className="w-full max-w-[400px] animate-slide-up">
          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-md-primary-container">
              <Globe className="h-5 w-5 text-md-on-primary-container" aria-hidden="true" />
            </div>
            <span className="font-display text-xl font-semibold text-foreground tracking-tight">
              {t('brand')}
            </span>
          </div>

          {/* Page heading */}
          <div className="mb-8">
            <h2 className="font-display text-2xl font-bold text-foreground tracking-tight">
              {t('customerRegister')}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('hasAccount')}{' '}
              <Link
                href="/portal/login"
                className="font-medium text-md-primary hover:underline
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 rounded-lg"
              >
                {t('goLogin')}
              </Link>
            </p>
          </div>

          {/* Form card */}
          <div className="bg-md-surface-container-lowest border rounded-2xl p-6 elevation-1">
            {/* react-doctor-disable-next-line react-doctor/no-prevent-default -- static-export SPA against a Go API; server actions are not available */}
            <form noValidate aria-label={t('registerFormLabel')} onSubmit={handleSubmit}>
              <div className="space-y-5">
                {/* Error banner — top of form, reserved space avoids layout shift */}
                <div role="alert" aria-live="assertive" aria-atomic="true">
                  {error && (
                    <div
                      id="form-error"
                      className="rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container animate-fade-in"
                    >
                      {error}
                    </div>
                  )}
                </div>

                {/* Referral code chip — visible feedback when applied via ?ref= */}
                {referralCode && (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-md-secondary-container px-3.5 py-2.5 text-sm text-md-on-secondary-container">
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <Tag className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {t('referralCodeApplied', { code: referralCode })}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setReferralCode('')}
                      aria-label={t('removeReferralCode')}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-md-on-secondary-container/80 transition-colors hover:bg-md-on-secondary-container/10 hover:text-md-on-secondary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}

                {/* Email */}
                <div className="space-y-1.5 animate-slide-up" style={{ animationDelay: '40ms' }}>
                  <Label htmlFor="email" className="text-sm font-medium text-foreground">
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
                    aria-required={true}
                    error={fieldErrors.email}
                    className="bg-background focus-visible:ring-md-primary"
                  />
                </div>

                {/* Nickname */}
                <div className="space-y-1.5 animate-slide-up" style={{ animationDelay: '80ms' }}>
                  <Label htmlFor="nickname" className="text-sm font-medium text-foreground">
                    {t('nickname')}
                  </Label>
                  <Input
                    id="nickname"
                    placeholder={t('nicknamePlaceholder') || ''}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    autoComplete="nickname"
                    required
                    aria-required={true}
                    minLength={2}
                    maxLength={20}
                    error={fieldErrors.nickname}
                    className="bg-background focus-visible:ring-md-primary"
                  />
                </div>

                {/* Password */}
                <div className="space-y-1.5 animate-slide-up" style={{ animationDelay: '120ms' }}>
                  <Label htmlFor="password" className="text-sm font-medium text-foreground">
                    {t('password')}
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    aria-required={true}
                    minLength={8}
                    passwordToggleLabel={t('togglePasswordVisibility')}
                    error={fieldErrors.password}
                    helperText={t('passwordHint')}
                    className="bg-background focus-visible:ring-md-primary"
                  />
                </div>

                {/* Submit */}
                <div className="animate-slide-up pt-1" style={{ animationDelay: '160ms' }}>
                  <Button
                    type="submit"
                    size="lg"
                    loading={loading}
                    disabled={success}
                    className="w-full"
                  >
                    {loading ? (
                      <span>{t('registering')}</span>
                    ) : success ? (
                      <span>{t('registerSuccess')}</span>
                    ) : (
                      <>
                        <span>{t('register')}</span>
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
