import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations, useLocale } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import { portalSessionApi } from '@/lib/openapi-session';
import { PortalService } from '@/src/generated/client';
import type { model_Order } from '@/src/generated/client/models/model_Order';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  RefreshCw, ShoppingBag, ChevronRight, Clock, Check, X, RotateCcw, AlertTriangle,
} from 'lucide-react';

const PAGE_SIZE = 20;

// status → Badge variant + leading icon (graphical reinforcement of meaning, §10)
const STATUS_META: Record<
  string,
  { variant: 'warning' | 'success' | 'secondary' | 'destructive' | 'info'; Icon: React.ComponentType<{ className?: string }> }
> = {
  pending: { variant: 'warning', Icon: Clock },
  processing: { variant: 'info', Icon: Clock },
  paid: { variant: 'success', Icon: Check },
  cancelled: { variant: 'secondary', Icon: X },
  expired: { variant: 'secondary', Icon: Clock },
  refunded: { variant: 'info', Icon: RotateCcw },
  failed: { variant: 'destructive', Icon: AlertTriangle },
};

export default function PortalOrdersPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { customer, loading: authLoading } = useCustomer();

  const [orders, setOrders] = useState<model_Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<model_Order | null>(null);

  const tableTopRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Localised helpers — follow page language, not a hardcoded locale.
  const formatDate = useCallback(
    (s?: string) => {
      if (!s) return t('notAvailable');
      const d = new Date(s);
      if (isNaN(d.getTime())) return t('notAvailable');
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    },
    [locale, t],
  );

  const formatAmount = useCallback(
    (cents?: number) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency: 'CNY' }).format((cents ?? 0) / 100),
    [locale],
  );

  const statusLabel = useCallback(
    (status?: string) => {
      const s = status ?? '';
      if (!s) return t('notAvailable');
      const key = `status${s.charAt(0).toUpperCase()}${s.slice(1)}`;
      const label = t(key);
      // guard against a missing key falling through as the raw "statusFoo" string
      return label === key ? s : label;
    },
    [t],
  );

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await portalSessionApi(PortalService.portalOrders({ page, limit: PAGE_SIZE }));
      setOrders(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, page]);

  useEffect(() => {
    if (!authLoading && !customer) { router.replace('/portal/login'); return; }
    if (!authLoading && customer) loadOrders();
  }, [authLoading, customer, router, loadOrders]);

  // On page switch, scroll the table back into view (loading state stays visible).
  const goToPage = useCallback((next: number) => {
    setPage(next);
    tableTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (authLoading) return (
    <div className="flex items-center justify-center py-24" role="status" aria-live="polite" aria-busy="true">
      <div className="flex flex-col items-center gap-4">
        <div className="size-10 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-md-primary-container text-md-on-primary-container">
            <ShoppingBag className="size-5" aria-hidden="true" />
          </div>
          <h1 className="font-display text-2xl font-600 tracking-tight text-foreground">
            {t('ordersTitle')}
          </h1>
        </div>
        <Button
          variant="secondary"
          onClick={loadOrders}
          loading={loading}
          className="gap-2"
        >
          {!loading && <RefreshCw className="size-4" aria-hidden="true" />}
          {tCommon('refresh')}
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center justify-between gap-3 rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container"
        >
          <span className="flex items-center gap-3">
            <span className="size-2 rounded-full bg-md-error" aria-hidden="true" />
            {error}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadOrders}
            className="shrink-0 text-md-on-error-container hover:bg-md-on-error-container/10"
          >
            {t('retry')}
          </Button>
        </div>
      )}

      {/* Orders table card */}
      <div ref={tableTopRef} className="bg-card border rounded-xl overflow-hidden">
        <div role="region" aria-label={t('ordersListLabel')} className="overflow-x-auto">
          <Table aria-label={t('ordersListLabel')}>
            <TableHeader>
              <TableRow className="border-b bg-md-surface-container-high/50">
                <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                  {t('colOrderNo')}
                </TableHead>
                <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                  {t('colPlan')}
                </TableHead>
                <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                  {t('colAmount')}
                </TableHead>
                <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                  {t('colStatus')}
                </TableHead>
                <TableHead scope="col" className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                  {t('colCreatedAt')}
                </TableHead>
                <TableHead scope="col" className="w-10">
                  <span className="sr-only">{t('orderDetail')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <div className="flex items-center justify-center gap-3 py-16" role="status" aria-live="polite" aria-busy="true">
                      <div className="size-8 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin" aria-hidden="true" />
                      <span className="text-sm text-muted-foreground">{tCommon('loading')}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : orders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <div className="flex flex-col items-center gap-4 py-20" role="status" aria-live="polite">
                      <div className="flex size-16 items-center justify-center rounded-full bg-md-surface-container-high text-muted-foreground">
                        <ShoppingBag className="size-7" aria-hidden="true" />
                      </div>
                      <p className="text-sm text-muted-foreground">{t('noOrders')}</p>
                      <p className="text-xs text-muted-foreground">{t('ordersEmptyHint')}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                orders.map((order, i) => (
                  <TableRow
                    key={order.id}
                    className="cursor-pointer hover-state border-b last:border-0
                      focus-visible:outline-none focus-visible:bg-md-surface-container-high
                      animate-slide-up"
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    tabIndex={0}
                    role="button"
                    aria-label={t('orderRowLabel', { orderNo: order.order_no ?? '' })}
                    onClick={() => setDetail(order)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetail(order);
                      }
                    }}
                  >
                    <TableCell className="font-mono text-sm text-foreground">
                      {order.order_no}
                    </TableCell>
                    <TableCell className="text-sm text-foreground">
                      <span title={t('planNoLabel', { id: order.plan_id ?? '' })}>
                        {t('planNoLabel', { id: order.plan_id ?? '' })}
                      </span>
                    </TableCell>
                    <TableCell className="font-display text-sm font-600 text-foreground tabular-nums">
                      {formatAmount(order.amount)}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const meta = STATUS_META[order.status ?? ''] ?? { variant: 'secondary' as const, Icon: Clock };
                        const label = statusLabel(order.status);
                        return (
                          <Badge variant={meta.variant} className="gap-1.5" aria-label={label}>
                            <meta.Icon className="size-3" aria-hidden="true" />
                            {label}
                          </Badge>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(order.created_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
            {t('prevPage')}
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {page} / {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
            {t('nextPage')}
          </Button>
        </div>
      )}

      {/* Order detail dialog (uses fields already returned by the list call) */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{t('orderDetail')}</DialogTitle>
            <DialogDescription className="font-mono">{detail?.order_no}</DialogDescription>
          </DialogHeader>
          {detail && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('colPlan')}</dt>
                <dd className="text-foreground">{t('planNoLabel', { id: detail.plan_id ?? '' })}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('colStatus')}</dt>
                <dd>
                  {(() => {
                    const meta = STATUS_META[detail.status ?? ''] ?? { variant: 'secondary' as const, Icon: Clock };
                    const label = statusLabel(detail.status);
                    return (
                      <Badge variant={meta.variant} className="gap-1.5" aria-label={label}>
                        <meta.Icon className="size-3" aria-hidden="true" />
                        {label}
                      </Badge>
                    );
                  })()}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('colAmount')}</dt>
                <dd className="font-display font-600 text-foreground tabular-nums">{formatAmount(detail.amount)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('colOriginalAmount')}</dt>
                <dd className="tabular-nums text-foreground">{formatAmount(detail.original_amount)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('colPromoCode')}</dt>
                <dd className="text-foreground">{detail.promo_code_id ? `#${detail.promo_code_id}` : t('noPromoCode')}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('colCreatedAt')}</dt>
                <dd className="text-foreground">{formatDate(detail.created_at)}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('colPaidAt')}</dt>
                <dd className="text-foreground">{detail.paid_at ? formatDate(detail.paid_at) : t('notPaid')}</dd>
              </div>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
