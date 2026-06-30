import React, { useState } from 'react';
import { handlerAdminLoginRequestSchema } from '@/src/generated/zod/schemas';
import { AdminService } from '@/src/generated/client';
import type { handler_AdminLoginRequest } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslations } from 'next-intl';
import { ArrowRight, Loader2, Shield } from 'lucide-react';

export default function Login() {
  const t = useTranslations('auth');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="relative w-full max-w-[420px] animate-slide-up">
        {/* Header: icon + title */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl
              bg-md-primary-container text-md-on-primary-container mb-5
              elevation-1"
          >
            <Shield className="h-8 w-8" />
          </div>
          <h1 className="font-display text-3xl font-600 tracking-tight text-foreground">
            {t('hiveRegistry')}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('adminLogin')}</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border bg-card p-8 elevation-1">
          {/* react-doctor-disable-next-line react-doctor/no-prevent-default -- static-export SPA against a Go API; server actions are not available */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setLoading(true);
              setError('');
              try {
                const body = { username, password } as handler_AdminLoginRequest;
                handlerAdminLoginRequestSchema.parse(body);
                await sessionApi(AdminService.adminLogin({ requestBody: body }));
                window.location.href = '/dashboard';
              } catch (e: unknown) {
                setError(getErrorMessage(e, t('loginFailed')));
              } finally {
                setLoading(false);
              }
            }}
          >
            <div className="space-y-5">
              <div className="space-y-1.5" style={{ animationDelay: '60ms' }}>
                <Label
                  htmlFor="username"
                  className="text-xs font-500 text-muted-foreground uppercase tracking-wide"
                >
                  {t('username')}
                </Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                  className="h-11 rounded-lg bg-md-surface-container-high border-0
                    focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-0
                    text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="space-y-1.5" style={{ animationDelay: '100ms' }}>
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
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="h-11 rounded-lg bg-md-surface-container-high border-0
                    focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-0
                    text-foreground placeholder:text-muted-foreground"
                />
              </div>

              {error && (
                <div
                  className="flex items-start gap-3 rounded-xl
                    bg-md-error-container text-md-on-error-container
                    px-4 py-3 text-sm"
                >
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="state-layer ripple w-full h-11 rounded-lg
                  bg-md-primary text-md-on-primary
                  text-sm font-500 elevation-1
                  hover:elevation-2 transition-shadow
                  focus-visible:outline-none focus-visible:ring-2
                  focus-visible:ring-md-primary focus-visible:ring-offset-2
                  disabled:opacity-50 disabled:pointer-events-none"
                style={{ animationDelay: '140ms' }}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {t('login')}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
