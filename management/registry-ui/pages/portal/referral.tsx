import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import { portalSessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { PortalService } from '@/src/generated/client';
import type { handler_PortalReferralResponse } from '@/src/generated/client/models/handler_PortalReferralResponse';
import type { handler_PortalReferralRecord } from '@/src/generated/client/models/handler_PortalReferralRecord';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Copy, Check, Users, Coins, Wallet, Gift } from 'lucide-react';

const money = (c?: number) => '¥' + ((c ?? 0) / 100).toFixed(2);

export default function PortalReferralPage() {
  const t = useTranslations('portal');
  const router = useRouter();
  const { customer, loading: authLoading } = useCustomer();

  const [info, setInfo] = useState<handler_PortalReferralResponse | null>(null);
  const [records, setRecords] = useState<handler_PortalReferralRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await portalSessionApi(PortalService.portalReferral());
      setInfo(data);
      const rec = await portalSessionApi(
        PortalService.portalReferralRecords({ page: 1, limit: 20 }),
      );
      setRecords(rec.items ?? []);
    } catch (e) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!authLoading && !customer) { router.replace('/portal/login'); return; }
    if (!authLoading && customer) load();
  }, [authLoading, customer, router, load]);

  const handleCopy = useCallback(async () => {
    const link = window.location.origin + '/portal/register' + (info?.referral_link ?? '');
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [info]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t('referralTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('referralSubtitle')}</p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="gradient-brand-subtle">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Gift className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('yourCode')}</p>
              <p className="text-3xl font-bold tracking-wider text-foreground">{info?.referral_code ?? '—'}</p>
            </div>
          </div>
          <Button type="button" onClick={handleCopy} className="shrink-0">
            {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            {copied ? t('copied') : t('copyLink')}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('totalInvites')}</p>
              <p className="text-2xl font-semibold">{info?.total_invites ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('totalCommission')}</p>
              <p className="text-2xl font-semibold">{money(info?.total_commission)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('balance')}</p>
              <p className="text-2xl font-semibold">{money(info?.balance)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">{t('referralRecords')}</h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colReferee')}</TableHead>
                <TableHead>{t('colCommission')}</TableHead>
                <TableHead>{t('colRefStatus')}</TableHead>
                <TableHead>{t('colRefDate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">{t('noReferrals')}</TableCell>
                </TableRow>
              ) : (
                records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.referee_nickname}</TableCell>
                    <TableCell>{money(r.commission)}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'settled' ? 'default' : 'outline'}>
                        {r.status === 'settled' ? t('refStatusSettled') : t('refStatusPending')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.created_at ? new Date(r.created_at).toLocaleString() : ''}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
