import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Ticket } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { RefreshCw, TicketIcon, InboxIcon, ChevronRight, X } from 'lucide-react';
import { useTranslations } from 'next-intl';


function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

// M3 §10 status chip classes — no raw Tailwind palette
const STATUS_CHIP: Record<string, string> = {
  open:    'bg-md-primary-container text-md-on-primary-container',
  replied: 'bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]',
  closed:  'bg-muted text-muted-foreground',
};

const STATUS_DOT: Record<string, string> = {
  open:    'bg-md-primary',
  replied: 'bg-[hsl(43_96%_50%)]',
  closed:  'bg-md-outline',
};

export default function TicketsPage() {
  const t = useTranslations('tickets');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { user, loading: authLoading } = useCurrentUser();

  const [tickets, setTickets] = useState<model_Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter is driven by the URL so refresh / share / back restores the view.
  // Absent `status` query = no filter (show all); we never store a sentinel.
  const statusFilter = typeof router.query.status === 'string' ? router.query.status : '';

  const setStatusFilter = useCallback((status: string) => {
    const nextQuery = { ...router.query };
    if (!status) delete nextQuery.status;
    else nextQuery.status = status;
    router.push({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
  }, [router]);

  // Monotonic request id — ignore stale responses when the filter changes quickly.
  const reqIdRef = useRef(0);

  const loadTickets = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError('');
    try {
      const data = await sessionApi(AdminService.adminListTickets({
        status: statusFilter || undefined,
      }));
      if (reqId !== reqIdRef.current) return;
      setTickets(data?.items ?? []);
    } catch (e: unknown) {
      if (reqId !== reqIdRef.current) return;
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [statusFilter, t]);

  useEffect(() => {
    if (!authLoading && user?.can('ticket:read')) loadTickets();
  }, [authLoading, user, loadTickets]);

  useEffect(() => {
    if (!authLoading && user && !user.can('ticket:read')) router.replace('/dashboard');
  }, [authLoading, user, router]);

  if (authLoading) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      {/* M3 circular progress placeholder */}
      <div className="size-10 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin" />
    </div>
  );

  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* ── Page header ── */}
        <div className="flex items-start justify-between gap-4 animate-slide-up">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-10 rounded-xl bg-md-primary-container text-md-on-primary-container">
              <TicketIcon className="size-5" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-600 text-foreground tracking-tight">
                {t('title')}
              </h1>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={loadTickets}
            disabled={loading}
            className="state-layer ripple flex items-center gap-1.5 rounded-lg border
              bg-md-surface-container-low text-foreground hover:bg-md-surface-container
              focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
              transition-colors"
          >
            <RefreshCw aria-hidden="true" className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            <span>{tCommon('refresh')}</span>
          </Button>
        </div>

        {/* ── Toolbar — status filter ── */}
        <div
          className="flex items-center gap-3 animate-slide-up"
          style={{ animationDelay: '40ms' }}
        >
          <Select value={statusFilter || undefined} onValueChange={(v) => setStatusFilter(v)}>
            <SelectTrigger
              aria-label={t('filterByStatus')}
              clearable
              onClear={() => setStatusFilter('')}
              clearLabel={tCommon('clearFilter')}
              className="w-full sm:w-40 rounded-lg border bg-md-surface-container-low
              text-foreground focus:ring-2 focus:ring-md-primary"
            >
              <SelectValue placeholder={tCommon('all')} />
            </SelectTrigger>
            <SelectContent className="rounded-xl bg-popover border elevation-2">
              <SelectItem value="open">{t('statusOpen')}</SelectItem>
              <SelectItem value="replied">{t('statusReplied')}</SelectItem>
              <SelectItem value="closed">{t('statusClosed')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ── Error banner ── */}
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl px-4 py-3
            bg-md-error-container text-md-on-error-container text-sm animate-fade-in"
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-md-error flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError('')}
              aria-label={tCommon('dismiss')}
              className="state-layer flex items-center justify-center size-8 -mr-1 rounded-full
                text-md-on-error-container focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-md-error focus-visible:ring-offset-1"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        )}

        {/* ── Tickets table surface ── */}
        <div
          className="bg-card border rounded-xl overflow-hidden animate-slide-up"
          style={{ animationDelay: '80ms' }}
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-md-surface-container-high hover:bg-md-surface-container-high">
                <TableHead className="w-16 text-xs font-500 text-muted-foreground uppercase tracking-wide">
                  {t('colId')}
                </TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                  {t('colCustomer')}
                </TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                  {t('colSubject')}
                </TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                  {t('colStatus')}
                </TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                  {t('colCreatedAt')}
                </TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">{t('colOpen')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                /* ── Loading state — skeleton rows keep table height stable ── */
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={`skeleton-${i}`} className="border-b border-border/60 last:border-0">
                    <TableCell><div className="h-4 w-8 rounded bg-md-surface-container-high animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-40 rounded bg-md-surface-container-high animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-48 rounded bg-md-surface-container-high animate-pulse" /></TableCell>
                    <TableCell><div className="h-5 w-16 rounded-full bg-md-surface-container-high animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-24 rounded bg-md-surface-container-high animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-4 rounded bg-md-surface-container-high animate-pulse" /></TableCell>
                  </TableRow>
                ))
              ) : tickets.length === 0 ? (
                /* ── Empty state ── */
                <TableRow>
                  <TableCell colSpan={6} className="py-16">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground animate-fade-in">
                      <div className="flex items-center justify-center size-12 rounded-full
                        bg-md-surface-container-high">
                        <InboxIcon aria-hidden="true" className="size-6 text-md-on-surface-variant" />
                      </div>
                      <p className="text-sm">{t('noTickets')}</p>
                      <Button variant="outline" size="sm" onClick={loadTickets} disabled={loading}>
                        <RefreshCw aria-hidden="true" className="size-4" />
                        <span>{tCommon('refresh')}</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                tickets.map((ticket, i) => {
                  const cap = ticket.status
                    ? ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)
                    : '';
                  const statusLabel = ticket.status ? t(`status${cap}`) : '';
                  const goToTicket = () => router.push(`/tickets/${ticket.id}`);
                  return (
                    <TableRow
                      key={ticket.id}
                      role="link"
                      tabIndex={0}
                      aria-label={`${t('colSubject')}: ${ticket.subject ?? ''}, ${t('colStatus')}: ${statusLabel}`}
                      className="hover-state cursor-pointer border-b border-border/60 last:border-0
                        transition-colors focus-visible:outline-none focus-visible:ring-2
                        focus-visible:ring-md-primary focus-visible:ring-inset"
                      style={{ animationDelay: `${i * 30}ms` }}
                      onClick={goToTicket}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          goToTicket();
                        }
                      }}
                    >
                      <TableCell className="font-display text-sm font-500 text-muted-foreground">
                        #{ticket.id}
                      </TableCell>
                      <TableCell className="text-sm text-foreground">
                        {ticket.customer_email ?? ''}
                      </TableCell>
                      <TableCell className="text-sm font-500 text-foreground">
                        {ticket.subject ?? ''}
                      </TableCell>
                      <TableCell>
                        {ticket.status ? (
                          <span className={`inline-flex items-center gap-1.5 rounded-full
                            px-2.5 py-0.5 text-xs font-500
                            ${STATUS_CHIP[ticket.status] ?? 'bg-muted text-muted-foreground'}`}>
                            <span aria-hidden="true" className={`size-1.5 rounded-full flex-shrink-0
                              ${STATUS_DOT[ticket.status] ?? 'bg-md-outline'}`} />
                            {statusLabel}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {ticket.created_at ? formatDate(ticket.created_at) : ''}
                      </TableCell>
                      <TableCell className="w-10 text-right">
                        <ChevronRight aria-hidden="true" className="size-4 opacity-40" />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

      </div>
    </div>
  );
}
