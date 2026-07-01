import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Ticket } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { RefreshCw, TicketIcon, InboxIcon, ChevronRight, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

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
  const fmt = useFormat();

  const [tickets, setTickets] = useState<model_Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // URL-synced pagination + filter state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [statusFilter, setStatusFilterState] = useState('');
  const [initialized, setInitialized] = useState(false);
  const syncUrl = useRef(false);

  // ── Restore filter / page / limit from URL once router.query is populated ──
  useEffect(() => {
    if (!router.isReady || initialized) return;
    const q = router.query;
    if (typeof q.status === 'string') setStatusFilterState(q.status);
    if (typeof q.page === 'string') {
      const p = parseInt(q.page, 10);
      if (Number.isFinite(p) && p > 0) setPage(p);
    }
    if (typeof q.limit === 'string') {
      const l = parseInt(q.limit, 10);
      if ([20, 50, 100].includes(l)) setLimit(l);
    }
    setInitialized(true);
  }, [router.isReady, router.query, initialized]);

  // ── Sync filter/page/limit changes to URL ──
  useEffect(() => {
    if (!initialized) return;
    if (!syncUrl.current) {
      syncUrl.current = true;
      return;
    }
    const query: Record<string, string | number> = {};
    if (statusFilter) query.status = statusFilter;
    if (page !== 1) query.page = page;
    if (limit !== 20) query.limit = limit;
    router.replace({ query }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, statusFilter, page, limit]);

  const setStatusFilter = useCallback((status: string) => {
    setStatusFilterState(status);
    setPage(1);
  }, []);

  // Monotonic request id — ignore stale responses when the filter changes quickly.
  const reqIdRef = useRef(0);

  const loadTickets = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError('');
    try {
      const data = await sessionApi(AdminService.adminListTickets({
        status: statusFilter || undefined,
        page,
        limit,
      }));
      if (reqId !== reqIdRef.current) return;
      setTickets(data?.items ?? []);
      setTotal(data?.total ?? 0);
    } catch (e: unknown) {
      if (reqId !== reqIdRef.current) return;
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [statusFilter, page, limit, t]);

  useEffect(() => {
    if (!initialized) return;
    if (!authLoading && user?.can('ticket:read')) loadTickets();
  }, [authLoading, user, loadTickets, initialized]);

  useEffect(() => {
    if (!authLoading && user && !user.can('ticket:read')) router.replace('/dashboard');
  }, [authLoading, user, router]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Build a type-safe status label map to avoid dynamic key interpolation.
  const STATUS_LABEL: Record<string, string> = {
    open:    t('statusOpen'),
    replied: t('statusReplied'),
    closed:  t('statusClosed'),
  };

  return (
    <PageContainer>

      {/* ── Page header ── */}
      <PageHeader
        icon={<TicketIcon />}
        title={t('title')}
        actions={
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
        }
      />

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
                {t('colUpdatedAt')}
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
                const statusLabel = STATUS_LABEL[ticket.status ?? ''] ?? ticket.status ?? '';
                return (
                  <TableRow
                    key={ticket.id}
                    tabIndex={0}
                    className="hover-state cursor-pointer border-b border-border/60 last:border-0
                      transition-colors focus-visible:outline-none focus-visible:ring-2
                      focus-visible:ring-md-primary focus-visible:ring-inset"
                    style={{ animationDelay: `${i * 30}ms` }}
                    onClick={() => router.push(`/tickets/${ticket.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/tickets/${ticket.id}`);
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
                      {/* Real anchor makes the subject cell keyboard/AT navigable as a link */}
                      <a
                        href={`/tickets/${ticket.id}`}
                        onClick={(e) => { e.preventDefault(); router.push(`/tickets/${ticket.id}`); }}
                        className="focus-visible:outline-none focus-visible:underline hover:underline"
                        tabIndex={-1}
                      >
                        {ticket.subject ?? ''}
                      </a>
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
                      {ticket.updated_at ? (
                        <span title={fmt.dateTime(ticket.updated_at)}>
                          {fmt.relative(ticket.updated_at)}
                        </span>
                      ) : ticket.created_at ? (
                        <span title={fmt.dateTime(ticket.created_at)}>
                          {fmt.relative(ticket.created_at)}
                        </span>
                      ) : ''}
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

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 animate-slide-up"
          style={{ animationDelay: '120ms' }}>
          {/* Per-page selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{tCommon('perPage')}</span>
            <Select
              value={String(limit)}
              onValueChange={(v) => { setLimit(Number(v)); setPage(1); }}
            >
              <SelectTrigger className="w-20 h-8 text-sm" aria-label={tCommon('perPage')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t('prevPage')}
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
              {t('pageOf', { page, totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              {t('nextPage')}
            </Button>
          </div>
        </div>
      )}

    </PageContainer>
  );
}
