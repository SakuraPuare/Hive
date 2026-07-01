import React, { useState } from 'react';
import Head from 'next/head';
import { z } from 'zod';
import { AdminService } from '@/src/generated/client';
import type { handler_AdminLoginRequest } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/router';
import { AlertCircle, LogIn } from 'lucide-react';

// Client-side validation schema with real min(1) constraints.
// The generated handlerAdminLoginRequestSchema uses .optional() fields and
// cannot serve as client validation; this schema closes that gap.
const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export default function Login() {
  const t = useTranslations('auth');
  const router = useRouter();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <>
      <Head>
        <title>{t('pageTitle')} — Hive Registry</title>
      </Head>
      {/* Skip link for keyboard users (mirrors portal/login.tsx pattern) */}
      <a
        href="#login-form"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-md-primary focus:px-4 focus:py-2 focus:text-md-on-primary focus:outline-none focus:ring-2 focus:ring-md-primary focus:ring-offset-2"
      >
        {t('skipToLoginForm')}
      </a>
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="relative w-full max-w-[420px] animate-slide-up">
          {/* Brand header — auth page icon intentionally larger than PageHeader (56px vs 44px) */}
          <div className="flex flex-col items-center mb-8">
            <div
              className="flex size-14 items-center justify-center rounded-2xl
                bg-md-primary-container text-md-on-primary-container mb-5
                elevation-1"
            >
              <LogIn className="size-6" aria-hidden="true" />
            </div>
            <h1 className="font-display text-2xl font-600 tracking-tight text-foreground">
              {t('hiveRegistry')}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{t('adminLogin')}</p>
          </div>

          {/* Card */}
          <main
            id="login-form"
            className="rounded-2xl border bg-card p-8 elevation-1"
          >
            {/* react-doctor-disable-next-line react-doctor/no-prevent-default -- static-export SPA against a Go API; server actions are not available */}
            <form
              noValidate
              aria-busy={loading}
              aria-label={t('adminLogin')}
              onSubmit={async (e) => {
                e.preventDefault();
                const uErr = username.trim() ? '' : t('usernameRequired');
                const pErr = password ? '' : t('passwordRequired');
                setUsernameError(uErr);
                setPasswordError(pErr);
                if (uErr || pErr) return;

                // Validate with a real schema (generated schema uses .optional()).
                const parsed = loginSchema.safeParse({ username, password });
                if (!parsed.success) return;

                setLoading(true);
                setError('');
                try {
                  const body = { username, password } as handler_AdminLoginRequest;
                  await sessionApi(AdminService.adminLogin({ requestBody: body }));
                  toast.success(t('loginSuccess'));
                  router.replace('/dashboard');
                  // Keep loading=true until navigation completes to prevent
                  // double-submit in the window between success and route change.
                  return;
                } catch (e: unknown) {
                  setError(getErrorMessage(e, t('loginFailed')));
                  setLoading(false);
                }
              }}
            >
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="username"
                    className="text-xs font-500 text-muted-foreground uppercase tracking-wide"
                  >
                    {t('username')}
                  </Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (usernameError) setUsernameError('');
                    }}
                    onBlur={() =>
                      setUsernameError(username.trim() ? '' : t('usernameRequired'))
                    }
                    autoComplete="username"
                    autoFocus
                    required
                    disabled={loading}
                    placeholder={t('usernamePlaceholder')}
                    error={usernameError || undefined}
                    aria-describedby={error ? 'admin-login-error' : undefined}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="password"
                    className="text-xs font-500 text-muted-foreground uppercase tracking-wide"
                  >
                    {t('password')}
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordError) setPasswordError('');
                    }}
                    onBlur={() =>
                      setPasswordError(password ? '' : t('passwordRequired'))
                    }
                    autoComplete="current-password"
                    required
                    disabled={loading}
                    error={passwordError || undefined}
                    showPasswordLabel={t('showPassword')}
                    hidePasswordLabel={t('hidePassword')}
                    aria-describedby={error ? 'admin-login-error' : undefined}
                  />
                </div>

                {error && (
                  <div
                    id="admin-login-error"
                    role="alert"
                    aria-atomic="true"
                    className="flex items-start gap-3 rounded-xl
                      bg-md-error-container text-md-on-error-container
                      px-4 py-3 text-sm"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  loading={loading}
                  className="w-full"
                >
                  {loading ? t('signingIn') : t('login')}
                </Button>
              </div>
            </form>
          </main>
        </div>
      </div>
    </>
  );
}
