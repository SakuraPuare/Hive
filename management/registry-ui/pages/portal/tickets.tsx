import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import { portalSessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { PortalService } from '@/src/generated/client';
import type { model_Ticket } from '@/src/generated/client/models/model_Ticket';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw, Plus, Ticket, AlertCircle, InboxIcon, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 20;

function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

/** M3 §10 status chip — open=info/primary, replied=warning, closed=idle */
function StatusChip({ status }: { status: string }) {
  const t = useTranslations('portal');
  const label = t(`status${status.charAt(0).toUpperCase() + status.slice(1)}`);

  if (status === 'open') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-primary-container text-md-on-primary-container">
        <span className="size-1.5 rounded-full bg-md-primary" />
        {label}
      </span>
    );
  }
  if (status === 'replied') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]">
        <span className="size-1.5 rounded-full bg-[hsl(43_96%_50%)]" />
        {label}
      </span>
    );
  }
  // closed / unknown → idle
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-muted text-muted-foreground">
      <span className="size-1.5 rounded-full bg-md-outline" />
      {label}
    </span>
  );
}

/** M3 circular progress indicator (SVG, replaces old text-only loading) */
function CircularProgress({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-20"
        cx="12" cy="12" r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-80"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z"
      />
    </svg>
  );
}

export default function PortalTicketsPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const { customer, loading: authLoading } = useCustomer();

  const [tickets, setTickets] = useState<model_Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTickets = useCallback(async (targetPage = 1) => {
    setLoading(true);
    setError('');
    try {
      const data = await portalSessionApi(PortalService.portalTickets({ page: targetPage, limit: PAGE_SIZE }));
      setTickets(data.items ?? []);
      setTotal(data.total ?? (data.items?.length ?? 0));
      setPage(targetPage);
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!authLoading && !customer) { router.replace('/portal/login'); return; }
    if (!authLoading && customer) loadTickets(1);
  }, [authLoading, customer, router, loadTickets]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // New ticket dialog
  const [showNew, setShowNew] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newContent, setNewContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!newSubject.trim() || !newContent.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await portalSessionApi(PortalService.portalCreateTicket({
        requestBody: { subject: newSubject.trim(), content: newContent.trim() },
      }));
      setShowNew(false);
      setNewSubject('');
      setNewContent('');
      toast.success(t('ticketCreated'));
      loadTickets(1);
    } catch (e: unknown) {
      setSubmitError(getErrorMessage(e, t('submitFailed')));
    } finally {
      setSubmitting(false);
    }
  }

  // Auth loading — M3 surface placeholder with circular progress
  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-24 animate-fade-in">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <CircularProgress className="size-8 text-md-primary" />
          <p className="text-sm">{tCommon('loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 animate-slide-up">
          <div className="flex size-10 items-center justify-center rounded-xl bg-md-primary-container text-md-on-primary-container">
            <Ticket className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-xl font-600 text-foreground">{t('ticketsTitle')}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{t('ticketsSubtitle')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 animate-slide-up" style={{ animationDelay: '40ms' }}>
          {/* Primary action */}
          <Button type="button" size="lg" className="h-11" onClick={() => setShowNew(true)}>
            <Plus className="size-4" aria-hidden="true" />
            <span>{t('newTicket')}</span>
          </Button>

          {/* Tonal secondary action */}
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="h-11"
            loading={loading}
            onClick={() => loadTickets(page)}
          >
            {!loading && <RefreshCw className="size-4" aria-hidden="true" />}
            <span>{tCommon('refresh')}</span>
          </Button>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────── */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl px-4 py-3
          bg-md-error-container text-md-on-error-container animate-slide-up"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <p className="text-sm flex-1">{error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => loadTickets(page)}
            className="border-md-on-error-container/30 text-md-on-error-container hover:bg-md-on-error-container/10"
          >
            {t('retry')}
          </Button>
        </div>
      )}

      {/* ── Ticket table card ─────────────────────────────────── */}
      <div className="bg-card border rounded-xl overflow-hidden animate-slide-up" style={{ animationDelay: '80ms' }}>
        <Table aria-label={t('ticketsTitle')}>
          <TableHeader>
            <TableRow className="border-b bg-md-surface-container-high/60">
              <TableHead className="w-16 text-xs font-500 uppercase tracking-wide text-muted-foreground">
                {t('colId')}
              </TableHead>
              <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                {t('colSubject')}
              </TableHead>
              <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                {t('colStatus')}
              </TableHead>
              <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                {t('colCreatedAt')}
              </TableHead>
              <TableHead className="w-10" aria-label={t('colActions')} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              /* Loading state — M3 circular progress centered */
              <TableRow>
                <TableCell colSpan={5} className="py-16">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground" role="status" aria-live="polite">
                    <CircularProgress className="size-7 text-md-primary" />
                    <p className="text-sm">{tCommon('loading')}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : tickets.length === 0 ? (
              /* Empty state */
              <TableRow>
                <TableCell colSpan={5} className="py-16">
                  <div className="flex flex-col items-center gap-4 text-muted-foreground" role="status">
                    <div className="flex size-12 items-center justify-center rounded-full bg-md-surface-container-high">
                      <InboxIcon className="size-6 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <p className="text-sm">{t('noTickets')}</p>
                    <Button type="button" size="lg" className="h-11" onClick={() => setShowNew(true)}>
                      <Plus className="size-4" aria-hidden="true" />
                      <span>{t('createFirstTicket')}</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              tickets.map((ticket, i) => {
                const go = () => router.push(`/portal/tickets/${ticket.id}`);
                return (
                  <TableRow
                    key={ticket.id}
                    role="link"
                    aria-label={t('viewTicket', { id: ticket.id ?? '', subject: ticket.subject ?? '' })}
                    className="cursor-pointer hover-state border-b border-md-outline-variant/40 last:border-0
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-md-primary
                      animate-slide-up"
                    style={{ animationDelay: `${120 + i * 30}ms` }}
                    onClick={go}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
                    }}
                  >
                    <TableCell className="text-xs font-500 text-muted-foreground font-display">
                      #{ticket.id}
                    </TableCell>
                    <TableCell className="font-500 text-foreground">
                      {ticket.subject}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={ticket.status ?? ''} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(ticket.created_at ?? '')}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* ── Pager / count ─────────────────────────────────── */}
        {!loading && tickets.length > 0 && (
          <div className="flex items-center justify-between gap-4 border-t border-md-outline-variant/40 px-4 py-3">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {t('showingTickets', { count: tickets.length, total })}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => loadTickets(page - 1)}
                >
                  {t('prevPage')}
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t('pageOf', { page, total: totalPages })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => loadTickets(page + 1)}
                >
                  {t('nextPage')}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── New ticket dialog ─────────────────────────────────── */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent
          size="md"
          pending={submitting}
          className="rounded-2xl border bg-card elevation-3 animate-scale-in"
        >
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-600 text-foreground">
              {t('newTicket')}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit}>
            <div className="space-y-5 py-1">
              <div className="space-y-1.5">
                <Label htmlFor="new-subject" className="text-sm font-500 text-foreground">
                  {t('subject')}
                  <span className="text-md-error" aria-hidden="true">*</span>
                </Label>
                <Input
                  id="new-subject"
                  autoFocus
                  required
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder={t('subjectPlaceholder')}
                  className="rounded-lg bg-md-surface-container-high border focus-visible:ring-md-primary"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-content" className="text-sm font-500 text-foreground">
                  {t('content')}
                  <span className="text-md-error" aria-hidden="true">*</span>
                </Label>
                <Textarea
                  id="new-content"
                  required
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  onSubmit={() => handleSubmit()}
                  submitHint={t('submitHint')}
                  placeholder={t('contentPlaceholder')}
                  minRows={5}
                  className="rounded-lg bg-md-surface-container-high border focus-visible:ring-md-primary"
                />
              </div>

              {submitError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5
                  bg-md-error-container text-md-on-error-container text-sm"
                >
                  <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                  <span>{submitError}</span>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 pt-1">
              {/* Outlined / text cancel */}
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11"
                disabled={submitting}
                onClick={() => setShowNew(false)}
              >
                {tCommon('cancel')}
              </Button>

              {/* Primary submit */}
              <Button
                type="submit"
                size="lg"
                className="h-11"
                loading={submitting}
                disabled={!newSubject.trim() || !newContent.trim()}
              >
                <span>{submitting ? t('submitting') : t('submit')}</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
