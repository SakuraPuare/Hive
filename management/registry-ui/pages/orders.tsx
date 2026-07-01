import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Order } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  RefreshCw,
  ShoppingCart,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ArrowDown,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

interface Order extends model_Order {
  customer_email?: string;
  plan_name?: string;
  promo_code?: string;
}

const PAGE_SIZE = 20;

function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

function formatAmount(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`;
}

// M3 status chip recipes — §10 of DESIGN_SYSTEM
function StatusChip({ status, label }: { status: string; label: string }) {
  const recipes: Record<string, string> = {
    paid: 'bg-md-tertiary-container text-md-on-tertiary-container',
    pending: 'bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]',
    cancelled: 'bg-muted text-muted-foreground',
    refunded: 'bg-md-error-container text-md-on-error-container',
  };
  const dotRecipes: Record<string, string> = {
    paid: 'bg-md-tertiary',
    pending: 'bg-[hsl(43_96%_50%)]',
    cancelled: 'bg-md-outline',
    refunded: 'bg-md-error',
  };
  const cls = recipes[status] ?? 'bg-muted text-muted-foreground';
  const dotCls = dotRecipes[status] ?? 'bg-md-outline';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <span className={`size-1.5 rounded-full ${dotCls}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export default function OrdersPage() {
  const t = useTranslations('orders');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const { user, loading: authLoading } = useCurrentUser();
  const canWrite = user?.can('order:write') ?? false;

  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Empty string = no status filter (show all). Radix Select can't take an
  // empty controlled value, so the trigger renders `undefined` + a clear
  // affordance instead of a sentinel `value="all"` option.
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [initialized, setInitialized] = useState(false);

  // ── Restore filter + page from URL on first ready render ──
  useEffect(() => {
    if (!router.isReady || initialized) return;
    const q = router.query;
    if (typeof q.status === 'string') setStatusFilter(q.status);
    if (typeof q.page === 'string') {
      const p = parseInt(q.page, 10);
      if (Number.isFinite(p) && p > 0) setPage(p);
    }
    setInitialized(true);
  }, [router.isReady, router.query, initialized]);

  // ── Persist filter + page to URL (shallow) ──
  const syncUrl = useRef(false);
  useEffect(() => {
    if (!initialized) return;
    // skip the very first sync triggered by restore to avoid a redundant replace
    if (!syncUrl.current) {
      syncUrl.current = true;
      return;
    }
    const query: Record<string, string> = {};
    if (statusFilter) query.status = statusFilter;
    if (page > 1) query.page = String(page);
    router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  }, [statusFilter, page, initialized, router]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await sessionApi(AdminService.adminListOrders({
        status: statusFilter || undefined,
        page,
        limit: PAGE_SIZE,
      }));
      setOrders((data.items ?? []) as Order[]);
      setTotal(data.total ?? 0);
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, t]);

  useEffect(() => {
    if (!authLoading && user?.can('order:read') && initialized) loadOrders();
  }, [authLoading, user, loadOrders, initialized]);

  useEffect(() => {
    if (!authLoading && user && !user.can('order:read')) router.replace('/dashboard');
  }, [authLoading, user, router]);

  function handleStatusChange(v: string) {
    setStatusFilter(v);
    setPage(1); // reset to first page when filter changes
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeTo = Math.min(page * PAGE_SIZE, total);

  const [markPaidTarget, setMarkPaidTarget] = useState<Order | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [markPaidError, setMarkPaidError] = useState('');

  async function handleMarkPaid() {
    if (!markPaidTarget) return;
    const orderNo = markPaidTarget.order_no ?? '';
    setMarkingPaid(true);
    setMarkPaidError('');
    try {
      await sessionApi(AdminService.adminUpdateOrderStatus({
        id: markPaidTarget.id!,
        requestBody: { status: 'paid' },
      }));
      setMarkPaidTarget(null);
      toast.success(t('markPaidSuccess', { orderNo }));
      loadOrders();
    } catch (e: unknown) {
      setMarkPaidError(getErrorMessage(e, t('markPaidFailed')));
    } finally {
      setMarkingPaid(false);
    }
  }

  // Auth loading placeholder
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          {/* M3 circular progress indicator */}
          <svg
            className="size-10 animate-spin text-md-primary"
            viewBox="0 0 24 24"
            fill="none"
            role="status"
            aria-label={tCommon('loading')}
          >
            <circle
              className="opacity-20"
              cx="12" cy="12" r="10"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              d="M12 2 a10 10 0 0 1 10 10"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
        </div>
      </div>
    );
  }

  const colSpan = canWrite ? 9 : 8;

  return (
    <div className="p-6 space-y-6 bg-background min-h-full">

      {/* ── Page header ── */}
      <div
        className="flex items-start justify-between gap-4 animate-slide-up"
        style={{ animationDelay: '0ms' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-md-primary-container text-md-on-primary-container">
            <ShoppingCart className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-600 text-foreground tracking-tight">
              {t('title')}
            </h1>
          </div>
        </div>

        {/* Refresh is a utility action — outlined, not the fill-primary slot (M3 §). */}
        <Button
          variant="outline"
          onClick={loadOrders}
          loading={loading}
        >
          {!loading && <RefreshCw className="size-4" aria-hidden="true" />}
          <span>{tCommon('refresh')}</span>
        </Button>
      </div>

      {/* ── Toolbar: status filter ── */}
      <div
        className="flex items-center gap-3 animate-slide-up"
        style={{ animationDelay: '60ms' }}
      >
        <label htmlFor="order-status-filter" className="text-sm font-medium text-muted-foreground">
          {t('filterByStatus')}
        </label>
        <Select value={statusFilter || undefined} onValueChange={handleStatusChange}>
          <SelectTrigger
            id="order-status-filter"
            aria-label={t('filterByStatus')}
            clearable
            onClear={() => handleStatusChange('')}
            clearLabel={tCommon('clearFilter')}
            className="w-44 rounded-lg border bg-md-surface-container-high text-foreground text-sm"
          >
            <SelectValue placeholder={tCommon('all')} />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="pending">{t('statusPending')}</SelectItem>
            <SelectItem value="paid">{t('statusPaid')}</SelectItem>
            <SelectItem value="cancelled">{t('statusCancelled')}</SelectItem>
            <SelectItem value="refunded">{t('statusRefunded')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl bg-md-error-container text-md-on-error-container px-4 py-3 text-sm animate-slide-up"
          style={{ animationDelay: '80ms' }}
        >
          <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Orders table ── */}
      <div
        className="bg-card border rounded-xl overflow-x-auto animate-slide-up"
        style={{ animationDelay: '120ms' }}
      >
        <Table aria-label={t('tableCaption')}>
          <TableCaption className="sr-only">
            {t('tableCaptionDetailed')}
          </TableCaption>
          <TableHeader>
            <TableRow className="bg-md-surface-container-high border-b">
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground py-3">
                {t('colOrderNo')}
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground py-3">
                {t('colCustomer')}
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground py-3">
                {t('colPlan')}
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground py-3">
                {t('colAmount')}
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground py-3">
                {t('colOriginalAmount')}
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground py-3">
                {t('colPromoCode')}
              </TableHead>
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground py-3">
                {t('colStatus')}
              </TableHead>
              {/* Server returns newest-first; surface that as the declared default sort. */}
              <TableHead
                aria-sort="descending"
                className="text-xs font-medium uppercase tracking-wide text-muted-foreground py-3"
              >
                <span className="inline-flex items-center gap-1" title={t('sortedByCreatedDesc')}>
                  {t('colCreatedAt')}
                  <ArrowDown className="size-3" aria-hidden="true" />
                  <span className="sr-only">{t('sortedByCreatedDesc')}</span>
                </span>
              </TableHead>
              {canWrite && (
                <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground py-3">
                  {t('colActions')}
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <svg
                      className="size-8 animate-spin text-md-primary"
                      viewBox="0 0 24 24"
                      fill="none"
                      role="status"
                      aria-label={tCommon('loading')}
                    >
                      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path d="M12 2 a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    <span className="text-sm text-muted-foreground">{tCommon('loading')}</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-20 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex items-center justify-center size-12 rounded-2xl bg-md-surface-container-high text-muted-foreground">
                      <ShoppingCart className="size-6" aria-hidden="true" />
                    </div>
                    {statusFilter ? (
                      <>
                        <p className="text-sm text-muted-foreground">
                          {t('noOrdersFiltered', { status: t(`status${statusFilter.charAt(0).toUpperCase()}${statusFilter.slice(1)}`) })}
                        </p>
                        <Button variant="outline" size="sm" onClick={() => handleStatusChange('')}>
                          {t('viewAll')}
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">{t('noOrders')}</p>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order, i) => (
                <TableRow
                  key={order.id}
                  className="hover-state border-b border-md-outline-variant/50 last:border-0 animate-slide-up"
                  style={{ animationDelay: `${160 + i * 30}ms` }}
                >
                  <TableCell className="py-3">
                    <span className="font-mono text-xs bg-md-surface-container-highest px-2 py-0.5 rounded-md text-foreground">
                      {order.order_no}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 text-sm text-foreground max-w-[200px] truncate" title={order.customer_email}>
                    {order.customer_email}
                  </TableCell>
                  <TableCell className="py-3 text-sm text-foreground max-w-[160px] truncate" title={order.plan_name}>
                    {order.plan_name}
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="font-display text-sm font-600 text-foreground">
                      {formatAmount(order.amount ?? 0)}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 text-sm text-muted-foreground">
                    {formatAmount(order.original_amount ?? 0)}
                  </TableCell>
                  <TableCell className="py-3 text-sm">
                    {order.promo_code ? (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-md-secondary-container text-md-on-secondary-container">
                        {order.promo_code}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    <StatusChip
                      status={order.status ?? ''}
                      label={t(`status${(order.status ?? '').charAt(0).toUpperCase() + (order.status ?? '').slice(1)}`)}
                    />
                  </TableCell>
                  <TableCell className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {formatDate(order.created_at ?? '')}
                  </TableCell>
                  {canWrite && (
                    <TableCell className="py-3">
                      {order.status === 'pending' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="bg-md-tertiary-container text-md-on-tertiary-container py-2"
                          aria-label={`${t('markPaid')} ${order.order_no ?? ''}`}
                          onClick={() => setMarkPaidTarget(order)}
                        >
                          {t('markPaid')}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Server-side pagination bar ── */}
      {!loading && total > 0 && (
        <nav
          aria-label={t('paginationLabel')}
          className="flex items-center justify-between gap-4 animate-slide-up"
          style={{ animationDelay: '140ms' }}
        >
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('pageRange', { from: rangeFrom, to: rangeTo, total })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              <span>{t('prevPage')}</span>
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums px-1">
              {t('pageOf', { page, totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <span>{t('nextPage')}</span>
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      )}

      {/* ── Mark paid confirmation dialog ── */}
      <Dialog open={!!markPaidTarget} onOpenChange={(open) => { if (!open) setMarkPaidTarget(null); }}>
        <DialogContent
          pending={markingPaid}
          className="rounded-2xl bg-md-surface-container elevation-3 border-0 max-w-md animate-scale-in"
        >
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-600 text-foreground">
              {t('markPaid')}
            </DialogTitle>
            <DialogDescription className="text-sm text-foreground leading-relaxed">
              {t('markPaidConfirm', { orderNo: markPaidTarget?.order_no ?? '' })}
              {' '}
              {t('markPaidIrreversible')}
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-3">
            {markPaidTarget?.order_no && (
              <div className="flex items-center gap-2 rounded-xl bg-md-surface-container-high px-4 py-3">
                <span className="text-xs text-muted-foreground">{t('colOrderNo')}</span>
                <span className="font-mono text-xs font-medium text-foreground">{markPaidTarget.order_no}</span>
                {markPaidTarget.amount !== undefined && (
                  <span className="ml-auto font-display text-base font-600 text-md-tertiary">
                    {formatAmount(markPaidTarget.amount ?? 0)}
                  </span>
                )}
              </div>
            )}
            {markPaidError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl bg-md-error-container text-md-on-error-container px-4 py-3 text-sm"
              >
                <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{markPaidError}</span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" disabled={markingPaid}>
                {tCommon('cancel')}
              </Button>
            </DialogClose>
            <Button
              onClick={handleMarkPaid}
              loading={markingPaid}
            >
              {t('confirmMarkPaid')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
