import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Ticket } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';


function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  replied: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-gray-100 text-gray-600',
};

export default function TicketsPage() {
  const t = useTranslations('tickets');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { user, loading: authLoading } = useCurrentUser();

  const [tickets, setTickets] = useState<model_Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await sessionApi(AdminService.adminListTickets({
        status: statusFilter !== 'all' ? statusFilter : undefined,
      }));
      setTickets(data?.items ?? []);
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  useEffect(() => {
    if (!authLoading && user?.can('ticket:read')) loadTickets();
  }, [authLoading, user, loadTickets]);

  useEffect(() => {
    if (!authLoading && user && !user.can('ticket:read')) router.replace('/dashboard');
  }, [authLoading, user, router]);

  if (authLoading) return <p className="p-6 text-sm text-muted-foreground">{tCommon('loading')}</p>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Button variant="outline" size="sm" onClick={loadTickets} disabled={loading}>
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
            <SelectItem value="open">{t('statusOpen')}</SelectItem>
            <SelectItem value="replied">{t('statusReplied')}</SelectItem>
            <SelectItem value="closed">{t('statusClosed')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">{t('colId')}</TableHead>
              <TableHead>{t('colCustomer')}</TableHead>
              <TableHead>{t('colSubject')}</TableHead>
              <TableHead>{t('colStatus')}</TableHead>
              <TableHead>{t('colCreatedAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{tCommon('loading')}</TableCell>
              </TableRow>
            ) : tickets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('noTickets')}</TableCell>
              </TableRow>
            ) : (
              tickets.map((ticket) => (
                <TableRow
                  key={ticket.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/tickets/${ticket.id}`)}
                >
                  <TableCell className="text-muted-foreground">#{ticket.id}</TableCell>
                  <TableCell>{ticket.customer_email ?? ''}</TableCell>
                  <TableCell className="font-medium">{ticket.subject ?? ''}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_COLORS[ticket.status ?? ''] ?? ''}>
                      {ticket.status ? t(`status${ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}`) : ''}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{ticket.created_at ? formatDate(ticket.created_at) : ''}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
