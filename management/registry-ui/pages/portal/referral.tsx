import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { createColumnHelper } from '@tanstack/react-table';
import { useCustomer } from '@/lib/portal-auth';
import { portalSessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { PortalService } from '@/src/generated/client';
import type { handler_PortalReferralResponse } from '@/src/generated/client/models/handler_PortalReferralResponse';
import type { handler_PortalReferralRecord } from '@/src/generated/client/models/handler_PortalReferralRecord';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { useToast } from '@/components/ui/toast';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Copy, Check, Users, Coins, Wallet, Gift, RefreshCw,
} from 'lucide-react';

const PAGE_SIZE = 20;
const money = (c?: number) => '¥' + ((c ?? 0) / 100).toFixed(2);

type StatusFilter = 'all' | 'settled' | 'pending';

const col = createColumnHelper<handler_PortalReferralRecord>();

export default function PortalReferralPage() {
  const t = useTranslations('portal');
  const router = useRouter();
  const toast = useToast();
  const { customer, loading: authLoading } = useCustomer();

  const [info, setInfo] = useState<handler_PortalReferralResponse | null>(null);
  const [records, setRecords] = useState<handler_PortalReferralRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await portalSessionApi(PortalService.portalReferral());
      setInfo(data);
      const rec = await portalSessionApi(
        PortalService.portalReferralRecords({ page: targetPage, limit: PAGE_SIZE }),
      );
      setRecords(rec.items ?? []);
      setTotal(rec.total ?? 0);
    } catch (e) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!authLoading && !customer) { router.replace('/portal/login'); return; }
    if (!authLoading && customer) load(page);
  }, [authLoading, customer, router, page, load]);

  // Move focus to the error banner when it first appears (keyboard recovery).
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const handleCopy = useCallback(async () => {
    const link = window.location.origin + '/portal/register' + (info?.referral_link ?? '');
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setCopyStatus(t('linkCopied'));
      toast.success(t('linkCopied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyStatus(t('copyFailed'));
      toast.error(t('copyFailed'));
    }
  }, [info, t, toast]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // The API has no status query param, so the filter narrows the current page
  // client-side; pagination totals still come from the server's unfiltered total.
  const visibleRecords = statusFilter === 'all'
    ? records
    : records.filter((r) =>
        statusFilter === 'settled' ? r.status === 'settled' : r.status !== 'settled');

  const columns = useMemo(() => [
    col.accessor('referee_nickname', {
      header: t('colReferee'),
      enableSorting: false,
      cell: (i) => (
        <span className="font-500 text-foreground">{i.getValue() || '—'}</span>
      ),
    }),
    col.accessor('commission', {
      header: t('colCommission'),
      enableSorting: false,
      cell: (i) => (
        <span className="font-display font-600 text-foreground">{money(i.getValue())}</span>
      ),
    }),
    col.accessor('status', {
      header: t('colRefStatus'),
      enableSorting: false,
      cell: (i) =>
        i.getValue() === 'settled' ? (
          <Badge variant="success">
            <span className="size-1.5 rounded-full bg-md-on-tertiary-container" aria-hidden="true" />
            {t('refStatusSettled')}
          </Badge>
        ) : (
          <Badge variant="warning">
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            {t('refStatusPending')}
          </Badge>
        ),
    }),
    col.accessor('created_at', {
      header: t('colRefDate'),
      enableSorting: false,
      cell: (i) => {
        const v = i.getValue();
        return (
          <span className="text-xs text-muted-foreground">
            {v ? new Date(v).toLocaleString() : ''}
          </span>
        );
      },
    }),
  ], [t]);

  // Initial paint: a full-page spinner until the first payload lands. Page
  // navigation keeps the chrome visible and only disables the controls.
  if (authLoading || (loading && !info)) {
    return (
      <div className="flex items-center justify-center py-24">
        <div
          className="h-10 w-10 rounded-full border-[3px] border-md-primary-container border-t-md-primary animate-spin"
          style={{ animationDuration: '0.9s', animationTimingFunction: 'var(--ease-standard)' }}
          role="status"
          aria-label={t('loading')}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 animate-slide-up" style={{ animationDelay: '0ms' }}>
        <div>
          <h1 className="font-display text-2xl font-600 text-foreground tracking-tight">
            {t('referralTitle')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('referralSubtitle')}</p>
        </div>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => load(page)}
          loading={loading}
          aria-label={t('refresh')}
          title={t('refresh')}
          className="shrink-0"
        >
          {!loading && <RefreshCw className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="rounded-xl border border-md-error-container bg-md-error-container px-4 py-3 outline-none animate-slide-up"
          style={{ animationDelay: '40ms' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-md-on-error-container">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(page)}
              className="border-md-on-error-container/30 text-md-on-error-container hover:bg-md-on-error-container/10"
            >
              {t('retry')}
            </Button>
          </div>
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
              <Gift className="h-7 w-7" aria-hidden="true" />
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

          {/* copy-link button — tonal Button on the container surface */}
          <Button
            type="button"
            onClick={handleCopy}
            disabled={copied}
            className="shrink-0 bg-md-primary text-md-on-primary elevation-1 hover:bg-md-primary/90"
          >
            {copied
              ? <><Check className="h-4 w-4" aria-hidden="true" /><span>{t('copied')}</span></>
              : <><Copy className="h-4 w-4" aria-hidden="true" /><span>{t('copyLink')}</span></>}
          </Button>
        </div>
        {/* aria-live confirmation for copy success / failure (WCAG 4.1.3) */}
        <div role="status" aria-live="polite" className="sr-only">{copyStatus}</div>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: <Users className="h-5 w-5" aria-hidden="true" />,
            label: t('totalInvites'),
            value: String(info?.total_invites ?? 0),
            color: 'bg-md-secondary-container text-md-on-secondary-container',
            iconBg: 'bg-md-secondary text-md-on-secondary',
            delay: 120,
          },
          {
            icon: <Coins className="h-5 w-5" aria-hidden="true" />,
            label: t('totalCommission'),
            value: money(info?.total_commission),
            color: 'bg-md-tertiary-container text-md-on-tertiary-container',
            iconBg: 'bg-md-tertiary text-md-on-tertiary',
            delay: 160,
          },
          {
            icon: <Wallet className="h-5 w-5" aria-hidden="true" />,
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-600 text-foreground">
            {t('referralRecords')}
          </h2>
          {/* status filter */}
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
            <SelectTrigger size="sm" className="w-[160px]" aria-label={t('filterByStatus')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('statusAll')}</SelectItem>
              <SelectItem value="settled">{t('refStatusSettled')}</SelectItem>
              <SelectItem value="pending">{t('refStatusPending')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <DataTable
          columns={columns}
          data={visibleRecords}
          loading={loading}
          getRowId={(r) => String(r.id)}
          ariaLabel={t('referralRecords')}
          manualPagination
          pageIndex={page - 1}
          pageCount={totalPages}
          rowCount={total}
          pageSize={PAGE_SIZE}
          onPageChange={(idx) => setPage(idx + 1)}
          isFiltered={statusFilter !== 'all'}
          emptyMessage={t('noReferrals')}
          emptyFilteredMessage={t('noReferralsFiltered')}
          emptyAction={
            statusFilter === 'all' ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-muted-foreground/80">{t('noReferralsHint')}</p>
                <Button variant="secondary" size="sm" onClick={handleCopy}>
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  {t('copyLink')}
                </Button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setStatusFilter('all')}>
                {t('clearFilter')}
              </Button>
            )
          }
          paginationLabel={t('pagination')}
          previousPageLabel={t('prevPage')}
          nextPageLabel={t('nextPage')}
          firstPageLabel={t('firstPage')}
          lastPageLabel={t('lastPage')}
          renderRangeLabel={({ from, to, total: tot }) => `${from}–${to} / ${tot}`}
        />
      </div>

    </div>
  );
}
