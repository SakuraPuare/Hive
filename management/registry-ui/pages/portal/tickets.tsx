import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import { portalSessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { PortalService } from '@/src/generated/client';
import type { model_Ticket } from '@/src/generated/client/models/model_Ticket';
import { useFormat } from '@/lib/format';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { CircularProgress } from '@/components/ui/circular-progress';
import { RefreshCw, Plus, Ticket, AlertCircle, InboxIcon, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 20;

/** Known status values → label key map. Falls back to raw status string. */
const STATUS_KEY_MAP: Record<string, 'statusOpen' | 'statusReplied' | 'statusClosed' | 'statusUnknown'> = {
  open: 'statusOpen',
  replied: 'statusReplied',
  closed: 'statusClosed',
};

/** M3 §10 status chip — open=info/primary, replied=warning, closed=idle */
function StatusChip({ status }: { status: string }) {
  const t = useTranslations('portal');
  const key = STATUS_KEY_MAP[status];
  const label = key ? t(key) : (status || t('statusUnknown'));

  if (status === 'open') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-primary-container text-md-on-primary-container">
        <span className="size-1.5 rounded-full bg-md-primary" aria-hidden="true" />
        {label}
      </span>
    );
  }
  if (status === 'replied') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]">
        <span className="size-1.5 rounded-full bg-[hsl(43_96%_50%)]" aria-hidden="true" />
        {label}
      </span>
    );
  }
  // closed / unknown → idle
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-muted text-muted-foreground">
      <span className="size-1.5 rounded-full bg-md-outline" aria-hidden="true" />
      {label}
    </span>
  );
}

export default function PortalTicketsPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const fmt = useFormat();
  const { customer, loading: authLoading } = useCustomer();

  const [tickets, setTickets] = useState<model_Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Monotonic request ID — prevents stale responses overwriting newer data.
  const requestIdRef = useRef(0);

  const loadTickets = useCallback(async (targetPage = 1) => {
    const id = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const data = await portalSessionApi(PortalService.portalTickets({ page: targetPage, limit: PAGE_SIZE }));
      if (id !== requestIdRef.current) return; // stale response — discard
      setTickets(data.items ?? []);
      setTotal(data.total ?? (data.items?.length ?? 0));
      setPage(targetPage);
    } catch {
      if (id !== requestIdRef.current) return;
      setError(t('loadFailed'));
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!authLoading && !customer) { router.replace('/portal/login'); return; }
    if (!authLoading && customer) loadTickets(1);
  }, [authLoading, customer, router, loadTickets]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── New ticket dialog ──────────────────────────────────────────────────────
  const [showNew, setShowNew] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newContent, setNewContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Unsaved-changes guard: show AlertDialog before discarding draft
  const [showDiscard, setShowDiscard] = useState(false);

  const hasDraft = newSubject.trim() !== '' || newContent.trim() !== '';

  function resetDraft() {
    setNewSubject('');
    setNewContent('');
    setSubmitError('');
  }

  function handleDialogOpenChange(open: boolean) {
    if (!open && hasDraft) {
      // Intercept close attempt — show discard confirmation
      setShowDiscard(true);
      return;
    }
    setShowNew(open);
    if (!open) resetDraft();
  }

  function handleCancel() {
    if (hasDraft) {
      setShowDiscard(true);
    } else {
      setShowNew(false);
      resetDraft();
    }
  }

  function handleConfirmDiscard() {
    setShowDiscard(false);
    setShowNew(false);
    resetDraft();
  }

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
      resetDraft();
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
      <PageContainer width="content">
        <div className="flex items-center justify-center py-24 animate-fade-in">
          <div className="flex flex-col items-center gap-4 text-muted-foreground">
            <CircularProgress className="size-8 text-md-primary" label={tCommon('loading')} />
            <p className="text-sm" aria-hidden="true">{tCommon('loading')}</p>
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer width="content">

      {/* ── Page header ─────────────────────────────────────── */}
      <PageHeader
        icon={<Ticket />}
        title={t('ticketsTitle')}
        description={t('ticketsSubtitle')}
        actions={
          <>
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
            <Button type="button" size="lg" className="h-11" onClick={() => setShowNew(true)}>
              <Plus className="size-4" aria-hidden="true" />
              <span>{t('newTicket')}</span>
            </Button>
          </>
        }
      />

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
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <CircularProgress className="size-7 text-md-primary" label={tCommon('loading')} />
                    <p className="text-sm" aria-hidden="true">{tCommon('loading')}</p>
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
                      animate-slide-up motion-reduce:animate-none"
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
                    <TableCell
                      className="text-sm text-muted-foreground"
                      title={fmt.dateTime(ticket.created_at)}
                    >
                      {fmt.relative(ticket.created_at)}
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
              <nav aria-label={t('pagination')}>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    disabled={page <= 1}
                    aria-disabled={page <= 1 || undefined}
                    aria-label={t('prevPage')}
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
                    size="default"
                    disabled={page >= totalPages}
                    aria-disabled={page >= totalPages || undefined}
                    aria-label={t('nextPage')}
                    onClick={() => loadTickets(page + 1)}
                  >
                    {t('nextPage')}
                  </Button>
                </div>
              </nav>
            )}
          </div>
        )}
      </div>

      {/* ── New ticket dialog ─────────────────────────────────── */}
      <Dialog open={showNew} onOpenChange={handleDialogOpenChange}>
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
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11"
                disabled={submitting}
                onClick={handleCancel}
              >
                {tCommon('cancel')}
              </Button>
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

      {/* ── Discard-draft confirmation ────────────────────────── */}
      <AlertDialog open={showDiscard} onOpenChange={setShowDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discardDraftTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('discardDraftDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDiscard(false)}>
              {t('keepEditing')}
            </AlertDialogCancel>
            <AlertDialogAction destructive onClick={handleConfirmDiscard}>
              {t('discardDraft')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </PageContainer>
  );
}
