import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Order } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw, ShoppingCart, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface Order extends model_Order {
  customer_email?: string;
  plan_name?: string;
  promo_code?: string;
}

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
      <span className={`size-1.5 rounded-full ${dotCls}`} />
      {label}
    </span>
  );
}

export default function OrdersPage() {
  const t = useTranslations('orders');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { user, loading: authLoading } = useCurrentUser();
  const canWrite = user?.can('order:write') ?? false;

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await sessionApi(AdminService.adminListOrders({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        page: undefined,
        limit: 20,
      }));
      setOrders((data.items ?? []) as Order[]);
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  useEffect(() => {
    if (!authLoading && user?.can('order:read')) loadOrders();
  }, [authLoading, user, loadOrders]);

  useEffect(() => {
    if (!authLoading && user && !user.can('order:read')) router.replace('/dashboard');
  }, [authLoading, user, router]);

  const [markPaidTarget, setMarkPaidTarget] = useState<Order | null>(null);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [markPaidError, setMarkPaidError] = useState('');

  async function handleMarkPaid() {
    if (!markPaidTarget) return;
    setMarkingPaid(true);
    setMarkPaidError('');
    try {
      await sessionApi(AdminService.adminUpdateOrderStatus({
        id: markPaidTarget.id!,
        requestBody: { status: 'paid' },
      }));
      setMarkPaidTarget(null);
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

  return (
    <div className="p-6 space-y-6 bg-background min-h-full">

      {/* ── Page header ── */}
      <div
        className="flex items-start justify-between gap-4 animate-slide-up"
        style={{ animationDelay: '0ms' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-md-primary-container text-md-on-primary-container">
            <ShoppingCart className="size-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-600 text-foreground tracking-tight">
              {t('title')}
            </h1>
          </div>
        </div>

        <button
          onClick={loadOrders}
          disabled={loading}
          className="state-layer ripple inline-flex items-center gap-2 rounded-lg px-4 py-2.5
            text-sm font-medium text-md-on-primary bg-md-primary elevation-1
            transition-shadow hover:elevation-2 disabled:opacity-50 disabled:cursor-not-allowed
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          <span>{tCommon('refresh')}</span>
        </button>
      </div>

      {/* ── Toolbar: status filter ── */}
      <div
        className="flex items-center gap-3 animate-slide-up"
        style={{ animationDelay: '60ms' }}
      >
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
          <SelectTrigger className="w-44 rounded-lg border bg-md-surface-container-high text-foreground text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="all">{tCommon('all')}</SelectItem>
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
          className="flex items-start gap-3 rounded-xl bg-md-error-container text-md-on-error-container px-4 py-3 text-sm animate-slide-up"
          style={{ animationDelay: '80ms' }}
        >
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Orders table ── */}
      <div
        className="bg-card border rounded-xl overflow-hidden animate-slide-up"
        style={{ animationDelay: '120ms' }}
      >
        <Table>
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
              <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground py-3">
                {t('colCreatedAt')}
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
                <TableCell colSpan={canWrite ? 9 : 8} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <svg
                      className="size-8 animate-spin text-md-primary"
                      viewBox="0 0 24 24"
                      fill="none"
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
                <TableCell colSpan={canWrite ? 9 : 8} className="py-20 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex items-center justify-center size-12 rounded-2xl bg-md-surface-container-high text-muted-foreground">
                      <ShoppingCart className="size-6" />
                    </div>
                    <p className="text-sm text-muted-foreground">{t('noOrders')}</p>
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
                  <TableCell className="py-3 text-sm text-foreground">
                    {order.customer_email}
                  </TableCell>
                  <TableCell className="py-3 text-sm text-foreground">
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
                  <TableCell className="py-3 text-xs text-muted-foreground">
                    {formatDate(order.created_at ?? '')}
                  </TableCell>
                  {canWrite && (
                    <TableCell className="py-3">
                      {order.status === 'pending' && (
                        <button
                          onClick={() => setMarkPaidTarget(order)}
                          className="state-layer ripple inline-flex items-center justify-center gap-1.5
                            rounded-lg px-3 py-1.5 text-xs font-medium
                            bg-md-tertiary-container text-md-on-tertiary-container
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
                        >
                          <span>{t('markPaid')}</span>
                        </button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Mark paid confirmation dialog ── */}
      <Dialog open={!!markPaidTarget} onOpenChange={(open) => { if (!open) setMarkPaidTarget(null); }}>
        <DialogContent className="rounded-2xl bg-md-surface-container elevation-3 border-0 max-w-md animate-scale-in">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-600 text-foreground">
              {t('markPaid')}
            </DialogTitle>
          </DialogHeader>

          <div className="py-2 space-y-3">
            <p className="text-sm text-foreground leading-relaxed">
              {t('markPaidConfirm', { orderNo: markPaidTarget?.order_no ?? '' })}
            </p>
            {markPaidTarget?.order_no && (
              <div className="flex items-center gap-2 rounded-xl bg-md-surface-container-high px-4 py-3">
                <span className="text-xs text-muted-foreground">{t('colOrderNo')}</span>
                <span className="font-mono text-xs font-medium text-foreground">{markPaidTarget.order_no}</span>
                {markPaidTarget.amount !== undefined && (
                  <>
                    <span className="ml-auto font-display text-base font-600 text-md-tertiary">
                      {formatAmount(markPaidTarget.amount ?? 0)}
                    </span>
                  </>
                )}
              </div>
            )}
            {markPaidError && (
              <div className="flex items-start gap-2 rounded-xl bg-md-error-container text-md-on-error-container px-4 py-3 text-sm">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>{markPaidError}</span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <button
              onClick={() => setMarkPaidTarget(null)}
              className="state-layer inline-flex items-center justify-center rounded-lg px-4 py-2.5
                text-sm font-medium border text-foreground bg-transparent
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              <span>{tCommon('cancel')}</span>
            </button>
            <button
              onClick={handleMarkPaid}
              disabled={markingPaid}
              className="state-layer ripple inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5
                text-sm font-medium text-md-on-primary bg-md-primary elevation-1
                transition-shadow hover:elevation-2 disabled:opacity-50 disabled:cursor-not-allowed
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {markingPaid ? (
                <>
                  <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path d="M12 2 a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <span>{tCommon('saving')}</span>
                </>
              ) : (
                <span>{t('markPaid')}</span>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
