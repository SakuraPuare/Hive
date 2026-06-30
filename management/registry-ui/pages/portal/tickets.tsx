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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw, Plus, Ticket, AlertCircle, InboxIcon } from 'lucide-react';

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
  const { customer, loading: authLoading } = useCustomer();

  const [tickets, setTickets] = useState<model_Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await portalSessionApi(PortalService.portalTickets({}));
      setTickets(data.items ?? []);
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!authLoading && !customer) { router.replace('/portal/login'); return; }
    if (!authLoading && customer) loadTickets();
  }, [authLoading, customer, router, loadTickets]);

  // New ticket dialog
  const [showNew, setShowNew] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newContent, setNewContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  async function handleSubmit() {
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
      loadTickets();
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
            <Ticket className="size-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-600 text-foreground">{t('ticketsTitle')}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{t('ticketsTitle')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 animate-slide-up" style={{ animationDelay: '40ms' }}>
          {/* Primary action */}
          <button
            onClick={() => setShowNew(true)}
            className="state-layer ripple inline-flex items-center gap-1.5 rounded-lg px-4 py-2
              text-sm font-500 bg-md-primary text-md-on-primary elevation-1
              transition-shadow hover:elevation-2
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
          >
            <Plus className="size-4" />
            <span>{t('newTicket')}</span>
          </button>

          {/* Tonal secondary action */}
          <button
            onClick={loadTickets}
            disabled={loading}
            className="state-layer inline-flex items-center gap-1.5 rounded-lg px-4 py-2
              text-sm font-500 bg-md-secondary-container text-md-on-secondary-container
              disabled:opacity-40 disabled:cursor-not-allowed
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
          >
            {loading
              ? <CircularProgress className="size-4 text-md-on-secondary-container" />
              : <RefreshCw className="size-4" />
            }
            <span>{tCommon('refresh')}</span>
          </button>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3
          bg-md-error-container text-md-on-error-container animate-slide-up">
          <AlertCircle className="size-4 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* ── Ticket table card ─────────────────────────────────── */}
      <div className="bg-card border rounded-xl overflow-hidden animate-slide-up" style={{ animationDelay: '80ms' }}>
        <Table>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              /* Loading state — M3 circular progress centered */
              <TableRow>
                <TableCell colSpan={4} className="py-16">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <CircularProgress className="size-7 text-md-primary" />
                    <p className="text-sm">{tCommon('loading')}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : tickets.length === 0 ? (
              /* Empty state */
              <TableRow>
                <TableCell colSpan={4} className="py-16">
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <div className="flex size-12 items-center justify-center rounded-full bg-md-surface-container-high">
                      <InboxIcon className="size-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm">{t('noTickets')}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              tickets.map((ticket, i) => (
                <TableRow
                  key={ticket.id}
                  className="cursor-pointer hover-state border-b border-md-outline-variant/40 last:border-0
                    focus-visible:outline-none focus-visible:bg-md-surface-container-high
                    animate-slide-up"
                  style={{ animationDelay: `${120 + i * 30}ms` }}
                  onClick={() => router.push(`/portal/tickets/${ticket.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && router.push(`/portal/tickets/${ticket.id}`)}
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── New ticket dialog ─────────────────────────────────── */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="rounded-2xl border bg-card elevation-3 animate-scale-in sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-600 text-foreground">
              {t('newTicket')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-1">
            <div className="space-y-1.5">
              <Label className="text-sm font-500 text-foreground">{t('subject')}</Label>
              <Input
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                placeholder={t('subjectPlaceholder')}
                className="rounded-lg bg-md-surface-container-high border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-500 text-foreground">{t('content')}</Label>
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={t('contentPlaceholder')}
                rows={5}
                className="rounded-lg bg-md-surface-container-high border focus-visible:ring-md-primary resize-none"
              />
            </div>

            {submitError && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2.5
                bg-md-error-container text-md-on-error-container text-sm">
                <AlertCircle className="size-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-1">
            {/* Outlined / text cancel */}
            <button
              onClick={() => setShowNew(false)}
              className="state-layer inline-flex items-center justify-center rounded-lg px-4 py-2
                text-sm font-500 border border-md-outline-variant text-foreground
                bg-transparent hover:bg-md-surface-container-high
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {tCommon('cancel')}
            </button>

            {/* Primary submit */}
            <button
              onClick={handleSubmit}
              disabled={submitting || !newSubject.trim() || !newContent.trim()}
              className="state-layer ripple inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2
                text-sm font-500 bg-md-primary text-md-on-primary elevation-1
                disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {submitting && <CircularProgress className="size-4 text-md-on-primary" />}
              <span>{submitting ? t('submitting') : t('submit')}</span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
