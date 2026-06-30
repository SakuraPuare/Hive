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
      <div className="flex items-center justify-center py-24">
        {/* M3 circular indeterminate progress — ring with a gap that rotates */}
        <div
          className="h-10 w-10 rounded-full border-[3px] border-md-primary-container border-t-md-primary animate-spin"
          style={{ animationDuration: '0.9s', animationTimingFunction: 'var(--ease-standard)' }}
          role="status"
          aria-label="loading"
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="animate-slide-up" style={{ animationDelay: '0ms' }}>
        <h1 className="font-display text-2xl font-600 text-foreground tracking-tight">
          {t('referralTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('referralSubtitle')}</p>
      </div>

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div
          className="rounded-xl border border-md-error-container bg-md-error-container px-4 py-3 animate-slide-up"
          style={{ animationDelay: '40ms' }}
        >
          <p className="text-sm text-md-on-error-container">{error}</p>
        </div>
      )}

      {/* ── Hero / invite-code card ──────────────────────────────────────── */}
      <div
        className="bg-md-primary-container rounded-2xl px-6 py-6 elevation-1 animate-slide-up"
        style={{ animationDelay: '80ms' }}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {/* icon container */}
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-md-primary text-md-on-primary elevation-1">
              <Gift className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-500 uppercase tracking-wider text-md-on-primary-container/70">
                {t('yourCode')}
              </p>
              <p className="font-display text-4xl font-700 tracking-widest text-md-on-primary-container mt-0.5">
                {info?.referral_code ?? '—'}
              </p>
            </div>
          </div>

          {/* copy-link button — tonal style on the container surface */}
          <button
            type="button"
            onClick={handleCopy}
            className={[
              'state-layer ripple shrink-0 inline-flex items-center justify-center gap-2',
              'rounded-lg px-5 py-2.5 text-sm font-500',
              'bg-md-primary text-md-on-primary elevation-1',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2',
              'transition-all duration-150',
            ].join(' ')}
          >
            {copied
              ? <><Check className="h-4 w-4" /><span>{t('copied')}</span></>
              : <><Copy className="h-4 w-4" /><span>{t('copyLink')}</span></>}
          </button>
        </div>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: <Users className="h-5 w-5" />,
            label: t('totalInvites'),
            value: String(info?.total_invites ?? 0),
            color: 'bg-md-secondary-container text-md-on-secondary-container',
            iconBg: 'bg-md-secondary text-md-on-secondary',
            delay: 120,
          },
          {
            icon: <Coins className="h-5 w-5" />,
            label: t('totalCommission'),
            value: money(info?.total_commission),
            color: 'bg-md-tertiary-container text-md-on-tertiary-container',
            iconBg: 'bg-md-tertiary text-md-on-tertiary',
            delay: 160,
          },
          {
            icon: <Wallet className="h-5 w-5" />,
            label: t('balance'),
            value: money(info?.balance),
            color: 'bg-md-primary-container text-md-on-primary-container',
            iconBg: 'bg-md-primary text-md-on-primary',
            delay: 200,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className={`rounded-xl p-5 animate-slide-up ${stat.color}`}
            style={{ animationDelay: `${stat.delay}ms` }}
          >
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${stat.iconBg}`}>
                {stat.icon}
              </div>
              <div>
                <p className="text-xs font-500 uppercase tracking-wider opacity-70">
                  {stat.label}
                </p>
                <p className="font-display text-2xl font-700 tracking-tight mt-0.5">
                  {stat.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Records table ────────────────────────────────────────────────── */}
      <div
        className="space-y-4 animate-slide-up"
        style={{ animationDelay: '240ms' }}
      >
        <h2 className="font-display text-base font-600 text-foreground">
          {t('referralRecords')}
        </h2>

        <div className="rounded-xl border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-b bg-md-surface-container-high">
                <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                  {t('colReferee')}
                </TableHead>
                <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                  {t('colCommission')}
                </TableHead>
                <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                  {t('colRefStatus')}
                </TableHead>
                <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                  {t('colRefDate')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-16 text-center">
                    {/* M3 empty state */}
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-md-surface-container-high text-muted-foreground">
                        <Users className="h-7 w-7" />
                      </div>
                      <p className="text-sm text-muted-foreground">{t('noReferrals')}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                records.map((r, i) => (
                  <TableRow
                    key={r.id}
                    className="hover-state border-b last:border-0 animate-slide-up"
                    style={{ animationDelay: `${280 + i * 40}ms` }}
                  >
                    <TableCell className="font-500 text-foreground">
                      {r.referee_nickname}
                    </TableCell>
                    <TableCell className="font-display font-600 text-foreground">
                      {money(r.commission)}
                    </TableCell>
                    <TableCell>
                      {r.status === 'settled' ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-tertiary-container text-md-on-tertiary-container">
                          <span className="size-1.5 rounded-full bg-md-tertiary" />
                          {t('refStatusSettled')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]">
                          <span className="size-1.5 rounded-full bg-[hsl(43_96%_50%)]" />
                          {t('refStatusPending')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
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
