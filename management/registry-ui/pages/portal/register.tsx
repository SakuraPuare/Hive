import React, { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { portalRegister } from '@/lib/portal-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function PortalRegisterPage() {
  const t = useTranslations('portal');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">{t('brand')}</CardTitle>
          <CardDescription>{t('customerRegister')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setLoading(true);
              setError('');
              try {
                await portalRegister(email, password, nickname);
                window.location.href = '/portal/dashboard';
              } catch (e: any) {
                setError(e?.error || t('registerFailed'));
              } finally {
                setLoading(false);
              }
            }}
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t('email')}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nickname">{t('nickname')}</Label>
                <Input
                  id="nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">{t('password')}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t('registering') : t('register')}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                {t('hasAccount')}{' '}
                <Link href="/portal/login" className="text-primary hover:underline">
                  {t('goLogin')}
                </Link>
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
