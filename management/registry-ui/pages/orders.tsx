import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Order } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { RefreshCw } from 'lucide-react';
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

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
  refunded: 'bg-red-100 text-red-800',
};

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
    } catch (e: any) {
      setError(e?.error || t('loadFailed'));
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
    } catch (e: any) {
      setMarkPaidError(e?.error || t('markPaidFailed'));
    } finally {
      setMarkingPaid(false);
    }
  }

  if (authLoading) return <p className="p-6 text-sm text-muted-foreground">{tCommon('loading')}</p>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button variant="outline" size="sm" onClick={loadOrders} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          {tCommon('refresh')}
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tCommon('all')}</SelectItem>
            <SelectItem value="pending">{t('statusPending')}</SelectItem>
            <SelectItem value="paid">{t('statusPaid')}</SelectItem>
            <SelectItem value="cancelled">{t('statusCancelled')}</SelectItem>
            <SelectItem value="refunded">{t('statusRefunded')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colOrderNo')}</TableHead>
              <TableHead>{t('colCustomer')}</TableHead>
              <TableHead>{t('colPlan')}</TableHead>
              <TableHead>{t('colAmount')}</TableHead>
              <TableHead>{t('colOriginalAmount')}</TableHead>
              <TableHead>{t('colPromoCode')}</TableHead>
              <TableHead>{t('colStatus')}</TableHead>
              <TableHead>{t('colCreatedAt')}</TableHead>
              {canWrite && <TableHead>{t('colActions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 9 : 8} className="text-center py-8 text-muted-foreground">
                  {tCommon('loading')}
                </TableCell>
              </TableRow>
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canWrite ? 9 : 8} className="text-center py-8 text-muted-foreground">
                  {t('noOrders')}
                </TableCell>
              </TableRow>
            ) : (
              orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs">{order.order_no}</TableCell>
                  <TableCell>{order.customer_email}</TableCell>
                  <TableCell>{order.plan_name}</TableCell>
                  <TableCell>{formatAmount(order.amount ?? 0)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatAmount(order.original_amount ?? 0)}</TableCell>
                  <TableCell>{order.promo_code || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLORS[order.status ?? ''] ?? ''} variant="outline">
                      {t(`status${(order.status ?? '').charAt(0).toUpperCase() + (order.status ?? '').slice(1)}` as any)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(order.created_at ?? '')}</TableCell>
                  {canWrite && (
                    <TableCell>
                      {order.status === 'pending' && (
                        <Button size="sm" variant="outline" onClick={() => setMarkPaidTarget(order)}>
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

      <Dialog open={!!markPaidTarget} onOpenChange={(open) => { if (!open) setMarkPaidTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('markPaid')}</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm">{t('markPaidConfirm', { orderNo: markPaidTarget?.order_no ?? '' })}</p>
          {markPaidError && <p className="text-sm text-destructive">{markPaidError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPaidTarget(null)}>{tCommon('cancel')}</Button>
            <Button onClick={handleMarkPaid} disabled={markingPaid}>
              {markingPaid ? tCommon('saving') : t('markPaid')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
