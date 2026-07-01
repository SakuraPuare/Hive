import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { handler_TicketDetailResponse } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/toast';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { ArrowLeft, Send, Ticket } from 'lucide-react';
import { useTranslations } from 'next-intl';

// M3 status token map — §10 of DESIGN_SYSTEM.md
const STATUS_CHIP: Record<string, string> = {
  open:    'bg-md-primary-container text-md-on-primary-container',
  replied: 'bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]',
  closed:  'bg-muted text-muted-foreground',
};

export default function TicketDetailPage() {
  const t = useTranslations('tickets');
  const tCommon = useTranslations('common');
  const fmt = useFormat();
  const toast = useToast();
  const router = useRouter();
  const { id } = router.query;
  const { user, loading: authLoading } = useCurrentUser();

  const [ticket, setTicket] = useState<handler_TicketDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const sendErrorRef = useRef<HTMLDivElement>(null);

  const loadTicket = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await sessionApi(AdminService.adminGetTicket({ id: Number(id) }));
      setTicket(data);
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    if (!authLoading && user?.can('ticket:read') && id) loadTicket();
  }, [authLoading, user, id, loadTicket]);

  useEffect(() => {
    if (!authLoading && user && !user.can('ticket:read')) router.replace('/dashboard');
  }, [authLoading, user, router]);

  // Auto-scroll to bottom only when user is already near the bottom
  useEffect(() => {
    const container = conversationRef.current;
    if (!container) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      return;
    }
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [ticket?.replies?.length]);

  // Reply
  const [replyContent, setReplyContent] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  async function handleReply() {
    if (!ticket || !replyContent.trim()) return;
    setSending(true);
    setSendError('');
    try {
      await sessionApi(AdminService.adminReplyTicket({ id: Number(ticket.ticket!.id), requestBody: { content: replyContent.trim() } }));
      setReplyContent('');
      await loadTicket();
      toast.success(t('replySent'));
    } catch (e: unknown) {
      const msg = getErrorMessage(e, t('replyFailed'));
      setSendError(msg);
      sendErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } finally {
      setSending(false);
    }
  }

  // Close ticket
  const [closing, setClosing] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeError, setCloseError] = useState('');

  async function handleClose() {
    if (!ticket) return;
    setClosing(true);
    setCloseError('');
    try {
      await sessionApi(AdminService.adminCloseTicket({ id: Number(ticket.ticket!.id) }));
      setCloseOpen(false);
      await loadTicket();
      toast.success(t('ticketClosed'));
    } catch (e: unknown) {
      setCloseError(getErrorMessage(e, t('closeFailed')));
    } finally {
      setClosing(false);
    }
  }

  // M3 circular loading indicator
  if (authLoading || loading) {
    return (
      <PageContainer width="content">
        <div className="flex items-center justify-center min-h-[40vh] animate-fade-in">
          <div className="flex flex-col items-center gap-4">
            <div
              className="size-10 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin"
              style={{ animationDuration: '0.8s', animationTimingFunction: 'var(--ease-standard)' }}
              aria-label={tCommon('loading')}
            />
            <span className="text-sm text-muted-foreground">{tCommon('loading')}</span>
          </div>
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer width="content" className="space-y-5">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (typeof window !== 'undefined' && window.history.length <= 2) {
                router.replace('/tickets');
              } else {
                router.back();
              }
            }}
            className="-ml-2 text-md-on-surface-variant"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{tCommon('back')}</span>
          </Button>
        </div>
        <PageHeader icon={<Ticket />} title={t('title')} />
        <div
          role="alert"
          className="inline-flex items-center gap-2 rounded-xl bg-md-error-container text-md-on-error-container px-4 py-3 text-sm"
        >
          <span aria-hidden="true" className="size-2 rounded-full bg-md-error shrink-0" />
          {error}
        </div>
        <div>
          <Button variant="outline" onClick={loadTicket}>
            {tCommon('retry')}
          </Button>
        </div>
      </PageContainer>
    );
  }

  if (!ticket) return null;

  const isClosed = ticket.ticket?.status === 'closed';
  const statusKey = ticket.ticket?.status ?? '';

  return (
    <PageContainer width="content" className="space-y-5">
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length <= 2) {
              router.replace('/tickets');
            } else {
              router.back();
            }
          }}
          className="-ml-2 text-md-on-surface-variant"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>{tCommon('back')}</span>
        </Button>
      </div>

      {/* Page header */}
      <PageHeader
        icon={<Ticket />}
        title={ticket.ticket?.subject ?? ''}
        description={ticket.ticket?.customer_email}
        actions={
          <div className="flex items-center gap-2">
            {/* M3 status chip */}
            <span
              role="status"
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-500 ${STATUS_CHIP[statusKey] ?? 'bg-muted text-muted-foreground'}`}
            >
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-full ${
                  statusKey === 'open'
                    ? 'bg-md-primary'
                    : statusKey === 'replied'
                    ? 'bg-[hsl(43_96%_50%)]'
                    : 'bg-md-outline'
                }`}
              />
              <span className="sr-only">{t('colStatus')}: </span>
              {t(`status${statusKey.charAt(0).toUpperCase() + statusKey.slice(1)}`)}
            </span>
            {!isClosed && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => { setCloseError(''); setCloseOpen(true); }}
              >
                {t('close')}
              </Button>
            )}
          </div>
        }
      />

      {/* Conversation thread */}
      <div ref={conversationRef} className="space-y-3 overflow-y-auto max-h-[calc(100vh-16rem)]">
        <h2 className="sr-only">{t('replySection')}</h2>
        {(ticket.replies ?? []).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 animate-fade-in">
            <div className="size-12 rounded-full bg-md-surface-container-high flex items-center justify-center">
              <Send className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="text-sm text-muted-foreground">{t('noReplies')}</p>
          </div>
        ) : (
          ticket.replies!.map((reply, i) => {
            const isAdmin = reply.is_admin === true;
            const senderLabel =
              reply.author ||
              (isAdmin ? t('adminSender') : ticket.ticket?.customer_email || t('customerSender'));
            return (
              <div
                key={reply.id}
                className={`flex ${isAdmin ? 'justify-end' : 'justify-start'} animate-slide-up`}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                    isAdmin
                      ? 'bg-md-primary-container text-md-on-primary-container'
                      : 'bg-md-surface-container-high text-foreground border border-md-outline-variant'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-500 opacity-80">{senderLabel}</span>
                    <span
                      className="text-xs opacity-50"
                      title={fmt.dateTime(reply.created_at)}
                    >
                      {fmt.relative(reply.created_at)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{reply.content}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply compose */}
      {!isClosed && (
        <Card className="bg-card border rounded-xl animate-slide-up" style={{ animationDelay: '80ms' }}>
          <CardContent className="pt-5 pb-5 px-6 space-y-4">
            <Textarea
              aria-label={t('reply')}
              placeholder={t('replyPlaceholder')}
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              rows={4}
              busy={sending}
              onSubmit={handleReply}
              submitHint={t('replyShortcutHint')}
              className="rounded-lg bg-md-surface-container-high border-md-outline-variant
                focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-0
                focus-visible:border-md-primary text-sm"
            />
            {sendError && (
              <div
                ref={sendErrorRef}
                role="alert"
                className="flex items-center gap-2 rounded-lg bg-md-error-container text-md-on-error-container px-3 py-2 text-sm"
              >
                <span aria-hidden="true" className="size-1.5 rounded-full bg-md-error shrink-0" />
                {sendError}
              </div>
            )}
            <div className="flex items-center justify-end">
              <Button
                onClick={handleReply}
                loading={sending}
                disabled={!replyContent.trim()}
              >
                {!sending && <Send className="h-4 w-4" aria-hidden="true" />}
                <span>{sending ? t('sendingReply') : t('reply')}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Close-ticket confirmation */}
      <AlertDialog open={closeOpen} onOpenChange={(o) => { if (!closing) setCloseOpen(o); }}>
        <AlertDialogContent pending={closing}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('closeConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('closeConfirmBody', { subject: ticket.ticket?.subject ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {closeError && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg bg-md-error-container text-md-on-error-container px-3 py-2 text-sm"
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-md-error shrink-0" />
              {closeError}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closing}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={closing}
              loadingLabel={tCommon('saving')}
              onClick={(e) => { e.preventDefault(); handleClose(); }}
            >
              {t('close')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
