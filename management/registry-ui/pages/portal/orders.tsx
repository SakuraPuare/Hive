import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import { portalSessionApi } from '@/lib/openapi-session';
import { PortalService } from '@/src/generated/client';
import type { model_Order } from '@/src/generated/client/models/model_Order';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
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

  if (authLoading) return <p className="p-6 text-sm text-muted-foreground">{tCommon('loading')}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('ordersTitle')}</h1>
        <Button variant="outline" size="sm" onClick={loadOrders} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          {tCommon('refresh')}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colOrderNo')}</TableHead>
              <TableHead>{t('colPlan')}</TableHead>
              <TableHead>{t('colAmount')}</TableHead>
              <TableHead>{t('colStatus')}</TableHead>
              <TableHead>{t('colCreatedAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{tCommon('loading')}</TableCell>
              </TableRow>
            ) : orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('noOrders')}</TableCell>
              </TableRow>
            ) : (
              orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-sm">{order.order_no}</TableCell>
                  <TableCell>{order.plan_id}</TableCell>
                  <TableCell>¥{((order.amount ?? 0) / 100).toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_COLORS[order.status ?? ''] ?? ''}>
                      {t(`status${(order.status ?? '').charAt(0).toUpperCase() + (order.status ?? '').slice(1)}` as any)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(order.created_at ?? '')}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
