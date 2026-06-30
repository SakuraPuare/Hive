import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import { PortalService } from '@/src/generated/client';
import { portalSessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import type { handler_PortalTicketDetail } from '@/src/generated/client/models/handler_PortalTicketDetail';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
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
  const router = useRouter();
  const { id } = router.query;
  const { customer, loading: authLoading } = useCustomer();

  const [ticket, setTicket] = useState<handler_PortalTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadTicket = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await portalSessionApi(PortalService.portalGetTicket({ id: Number(id) }));
      setTicket(data);
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    if (!authLoading && !customer) { router.replace('/portal/login'); return; }
    if (!authLoading && customer && id) loadTicket();
  }, [authLoading, customer, id, router, loadTicket]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      await portalSessionApi(PortalService.portalReplyTicket({
        id: ticket.ticket!.id!,
        requestBody: { content: replyContent.trim() },
      }));
      setReplyContent('');
      await loadTicket();
    } catch (e: unknown) {
      setSendError(getErrorMessage(e, t('replyFailed')));
    } finally {
      setSending(false);
    }
  }

  // M3 loading state — circular-ish spinner via CSS animation, no raw p tag
  if (authLoading || loading) return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 animate-fade-in">
      <span className="size-10 rounded-full border-4 border-md-surface-container-high border-t-md-primary animate-spin" />
      <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
    </div>
  );
  if (error) return (
    <div className="flex items-center gap-3 rounded-xl bg-md-error-container px-5 py-4 text-md-on-error-container animate-slide-up">
      <span className="size-2 rounded-full bg-md-error shrink-0" />
      <p className="text-sm font-500">{error}</p>
    </div>
  );
  if (!ticket) return null;

  const tk = ticket.ticket!;
  const isClosed = tk.status === 'closed';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header — back button + title + status chip */}
      <div className="flex items-start gap-3 animate-slide-up">
        <button
          onClick={() => router.push('/portal/tickets')}
          className="state-layer shrink-0 inline-flex items-center justify-center gap-1.5
            rounded-lg px-3 py-2 text-sm font-500 text-md-on-primary-container
            bg-md-primary-container
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{tCommon('back')}</span>
        </button>

        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-600 text-foreground leading-snug">
            <span className="text-muted-foreground font-400">#{tk.id}</span>{' '}
            {tk.subject}
          </h1>
        </div>

        <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-500
          ${STATUS_CHIP[tk.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
          {t(`status${(tk.status ?? '').charAt(0).toUpperCase() + (tk.status ?? '').slice(1)}`)}
        </span>
      </div>

      {/* Conversation thread */}
      <div className="space-y-3 min-h-[200px]">
        {(!ticket.replies || ticket.replies.length === 0) ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 animate-slide-up">
            <span className="flex items-center justify-center size-12 rounded-full bg-md-surface-container-high">
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
                <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${
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

      {/* Reply form */}
      {!isClosed && (
        <Card className="rounded-xl border bg-card animate-slide-up">
          <CardContent className="pt-5 space-y-3">
            <Textarea
              placeholder={t('replyPlaceholder')}
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              rows={4}
              className="rounded-lg resize-none focus-visible:ring-md-primary"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleReply();
              }}
            />
            {sendError && (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <span className="size-1.5 rounded-full bg-md-error shrink-0" />
                {sendError}
              </p>
            )}
            <div className="flex justify-end">
              <button
                onClick={handleReply}
                disabled={sending || !replyContent.trim()}
                className="state-layer ripple inline-flex items-center justify-center gap-2
                  rounded-lg px-5 py-2.5 text-sm font-500
                  bg-md-primary text-md-on-primary elevation-1
                  transition-shadow hover:elevation-2
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                  disabled:opacity-38 disabled:pointer-events-none"
              >
                <Send className="h-4 w-4" />
                {sending ? tCommon('saving') : t('reply')}
              </button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
