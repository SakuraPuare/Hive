import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import { portalSessionApi } from '@/lib/openapi-session';
import { PortalService } from '@/src/generated/client';
import type { model_Order } from '@/src/generated/client/models/model_Order';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { RefreshCw, ShoppingBag } from 'lucide-react';

function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

// M3 §10 status token recipes
const STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]',
  paid: 'bg-md-tertiary-container text-md-on-tertiary-container',
  cancelled: 'bg-muted text-muted-foreground',
};

export default function PortalOrdersPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { customer, loading: authLoading } = useCustomer();

  const [orders, setOrders] = useState<model_Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await portalSessionApi(PortalService.portalOrders({}));
      setOrders(data.items ?? []);
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!authLoading && !customer) { router.replace('/portal/login'); return; }
    if (!authLoading && customer) loadOrders();
  }, [authLoading, customer, router, loadOrders]);

  if (authLoading) return (
    <div className="flex items-center justify-center py-24">
      <div className="flex flex-col items-center gap-4">
        <div className="size-10 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin" />
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
            <ShoppingBag className="size-5" />
          </div>
          <h1 className="font-display text-2xl font-600 tracking-tight text-foreground">
            {t('ordersTitle')}
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadOrders}
          disabled={loading}
          className="state-layer gap-2 rounded-lg border bg-card text-sm font-500 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          {tCommon('refresh')}
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container">
          <span className="size-2 rounded-full bg-md-error" />
          {error}
        </div>
      )}

      {/* Orders table card */}
      <div className="bg-card border rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-b bg-md-surface-container-high/50">
              <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                {t('colOrderNo')}
              </TableHead>
              <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                {t('colPlan')}
              </TableHead>
              <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                {t('colAmount')}
              </TableHead>
              <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                {t('colStatus')}
              </TableHead>
              <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                {t('colCreatedAt')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex items-center justify-center gap-3 py-16">
                    <div className="size-8 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin" />
                    <span className="text-sm text-muted-foreground">{tCommon('loading')}</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <div className="flex flex-col items-center gap-4 py-20">
                    <div className="flex size-16 items-center justify-center rounded-full bg-md-surface-container-high text-muted-foreground">
                      <ShoppingBag className="size-7" />
                    </div>
                    <p className="text-sm text-muted-foreground">{t('noOrders')}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order, i) => (
                <TableRow
                  key={order.id}
                  className="hover-state border-b last:border-0 animate-slide-up"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <TableCell className="font-mono text-sm text-foreground">
                    {order.order_no}
                  </TableCell>
                  <TableCell className="text-sm text-foreground">{order.plan_id}</TableCell>
                  <TableCell className="font-display text-sm font-600 text-foreground">
                    ¥{((order.amount ?? 0) / 100).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 ${STATUS_CLASSES[order.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                      {t(`status${(order.status ?? '').charAt(0).toUpperCase() + (order.status ?? '').slice(1)}`)}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(order.created_at ?? '')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
