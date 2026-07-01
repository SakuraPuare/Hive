import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import { PortalService } from '@/src/generated/client';
import { portalSessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import type { handler_PortalTicketDetail } from '@/src/generated/client/models/handler_PortalTicketDetail';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ArrowLeft, Send, MessageCircle } from 'lucide-react';


function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'medium' });
}

// M3 §10 status chip recipes — no raw Tailwind palette
const STATUS_CHIP: Record<string, string> = {
  open: 'bg-md-primary-container text-md-on-primary-container',
  replied: 'bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]',
  closed: 'bg-muted text-muted-foreground',
};

export default function PortalTicketDetailPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const router = useRouter();
  const { id } = router.query;
  const { customer, loading: authLoading } = useCustomer();

  const [ticket, setTicket] = useState<handler_PortalTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const firstRenderRef = useRef(true);

  // `silent` reloads (e.g. after sending a reply) skip the full-page spinner so the
  // conversation thread isn't torn down and remounted under the user.
  const loadTicket = useCallback(async (silent = false) => {
    if (!id) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await portalSessionApi(PortalService.portalGetTicket({ id: Number(id) }));
      setTicket(data);
    } catch {
      setError(t('loadFailed'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    if (!authLoading && !customer) { router.replace('/portal/login'); return; }
    if (!authLoading && customer && id) loadTicket();
  }, [authLoading, customer, id, router, loadTicket]);

  // Auto-scroll respects the reader's position: never on first paint (skips history),
  // and on new replies only when the user is already near the bottom.
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    const nearBottom =
      typeof window !== 'undefined' &&
      window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ticket?.replies?.length]);

  // Reply
  const [replyContent, setReplyContent] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const handleReply = useCallback(async () => {
    if (!ticket || !replyContent.trim() || sending) return;
    setSending(true);
    setSendError('');
    try {
      await portalSessionApi(PortalService.portalReplyTicket({
        id: ticket.ticket!.id!,
        requestBody: { content: replyContent.trim() },
      }));
      setReplyContent('');
      toast.success(t('replySent'));
      await loadTicket(true);
    } catch (e: unknown) {
      setSendError(getErrorMessage(e, t('replyFailed')));
    } finally {
      setSending(false);
    }
  }, [ticket, replyContent, sending, toast, t, loadTicket]);

  // M3 loading state — circular-ish spinner via CSS animation, no raw p tag
  if (authLoading || loading) return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 animate-fade-in">
      <span aria-hidden="true" className="size-10 rounded-full border-4 border-md-surface-container-high border-t-md-primary animate-spin" />
      <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
    </div>
  );
  if (error) return (
    <div className="flex flex-col items-center gap-4 py-16 animate-slide-up">
      <div role="alert" className="flex items-center gap-3 rounded-xl bg-md-error-container px-5 py-4 text-md-on-error-container">
        <span aria-hidden="true" className="size-2 rounded-full bg-md-error shrink-0" />
        <p className="text-sm font-500">{error}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => loadTicket()}>{t('retry')}</Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/portal/tickets">{tCommon('back')}</Link>
        </Button>
      </div>
    </div>
  );
  if (!ticket) return null;

  const tk = ticket.ticket!;
  const isClosed = tk.status === 'closed';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header — back button + title + status chip */}
      <div className="flex items-start gap-3 animate-slide-up">
        <Button variant="secondary" size="sm" className="shrink-0" asChild>
          <Link href="/portal/tickets">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{tCommon('back')}</span>
          </Link>
        </Button>

        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-600 text-foreground leading-snug">
            <span className="text-muted-foreground font-400">#{tk.id}</span>{' '}
            {tk.subject}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            <span>{t('createdLabel')} {formatDate(tk.created_at ?? '')}</span>
            {tk.updated_at && tk.updated_at !== tk.created_at && (
              <span> · {t('updatedLabel')} {formatDate(tk.updated_at)}</span>
            )}
          </p>
        </div>

        <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-500
          ${STATUS_CHIP[tk.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
          {t(`status${(tk.status ?? '').charAt(0).toUpperCase() + (tk.status ?? '').slice(1)}`)}
        </span>
      </div>

      {/* Conversation thread */}
      <div role="log" aria-live="polite" className="space-y-3 min-h-[200px] px-1 sm:px-0">
        {(!ticket.replies || ticket.replies.length === 0) ? (
          <div role="status" className="flex flex-col items-center justify-center gap-3 py-16 animate-slide-up">
            <span aria-hidden="true" className="flex items-center justify-center size-12 rounded-full bg-md-surface-container-high">
              <MessageCircle className="size-6 text-muted-foreground" />
            </span>
            <p className="text-sm text-muted-foreground">{t('noReplies')}</p>
          </div>
        ) : (
          ticket.replies.map((reply, i) => {
            const isAdmin = reply.is_admin;
            return (
              <div
                key={reply.id}
                className={`flex ${isAdmin ? 'justify-start' : 'justify-end'} animate-slide-up`}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 ${
                  isAdmin
                    ? 'bg-md-surface-container-high text-foreground'
                    : 'bg-md-primary text-md-on-primary'
                }`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-500 opacity-80">{reply.author}</span>
                    <span className="text-xs opacity-50">{formatDate(reply.created_at ?? '')}</span>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{reply.content}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Reply form — or closed-ticket banner */}
      {isClosed ? (
        <Card className="rounded-xl border bg-md-surface-container-high animate-slide-up">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <span aria-hidden="true" className="flex items-center justify-center size-12 rounded-full bg-md-surface-container">
              <MessageCircle className="size-6 text-muted-foreground" />
            </span>
            <p className="text-sm text-muted-foreground">{t('ticketClosedDesc')}</p>
            <Button asChild>
              <Link href="/portal/tickets">{t('submitNewTicket')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-xl border bg-card animate-slide-up">
          <CardContent className="pt-5 space-y-3">
            <label htmlFor="reply-content" className="sr-only">{t('replyContentLabel')}</label>
            <Textarea
              id="reply-content"
              placeholder={t('replyPlaceholder')}
              value={replyContent}
              onChange={(e) => { setReplyContent(e.target.value); if (sendError) setSendError(''); }}
              minRows={4}
              busy={sending}
              errorText={sendError || undefined}
              submitHint={t('replyShortcut')}
              onSubmit={handleReply}
              className="focus-visible:ring-md-primary"
            />
            <div className="flex justify-end">
              <Button
                onClick={handleReply}
                loading={sending}
                disabled={!replyContent.trim()}
              >
                {!sending && <Send className="h-4 w-4" aria-hidden="true" />}
                {t('reply')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
