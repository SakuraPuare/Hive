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
      <div className="absolute inset-0 gradient-brand-subtle" />
      <div className="relative w-full max-w-[400px] animate-fade-in">
        <div className="flex flex-col items-center mb-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl gradient-brand mb-4 shadow-lg shadow-primary/25">
            <Shield className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t('hiveRegistry')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('adminLogin')}</p>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
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
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t('username')}</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t('password')}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="h-11"
                />
              </div>
              {error && (
                <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <Button type="submit" className="w-full h-11 text-base font-medium" disabled={loading}>
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
