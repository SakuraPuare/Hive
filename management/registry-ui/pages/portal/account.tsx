import React from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useCustomer, portalLogout } from '@/lib/portal-auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  const status = customer.status ?? '';
  const created = customer.created_at ? new Date(customer.created_at).toLocaleString() : '-';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('accountTitle')}</h1>
        <Button type="button" variant="outline" size="sm" onClick={handleLogout}>
          <LogOut className="h-4 w-4 mr-1" />
          {t('logout')}
        </Button>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full gradient-brand text-2xl font-semibold text-primary-foreground">
              {initial(customer.nickname, customer.email)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-foreground">{customer.nickname || '-'}</p>
              <p className="truncate text-sm text-muted-foreground">{customer.email}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">{t('accountInfo')}</h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4" />
                {t('accountEmail')}
              </dt>
              <dd className="text-sm text-foreground">{customer.email}</dd>
            </div>

            <div className="space-y-1">
              <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                {t('accountNickname')}
              </dt>
              <dd className="text-sm text-foreground">{customer.nickname || '-'}</dd>
            </div>

            <div className="space-y-1">
              <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4" />
                {t('accountStatus')}
              </dt>
              <dd>
                {status === 'banned' ? (
                  <Badge className="bg-red-100 text-red-800">{t('statusBanned')}</Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-800">{t('statusActive')}</Badge>
                )}
              </dd>
            </div>

            <div className="space-y-1">
              <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                {t('accountCreated')}
              </dt>
              <dd className="text-sm text-foreground">{created}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
