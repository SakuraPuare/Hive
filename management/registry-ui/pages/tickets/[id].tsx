import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { handler_TicketDetailResponse } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';


function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'medium' });
}

// M3 status token map — §10 of DESIGN_SYSTEM.md
const STATUS_CHIP: Record<string, string> = {
  open:    'bg-md-primary-container text-md-on-primary-container',
  replied: 'bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]',
  closed:  'bg-muted text-muted-foreground',
};

export default function TicketDetailPage() {
  const t = useTranslations('tickets');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { id } = router.query;
  const { user, loading: authLoading } = useCurrentUser();

  const [ticket, setTicket] = useState<handler_TicketDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

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
      await sessionApi(AdminService.adminReplyTicket({ id: Number(ticket.ticket!.id), requestBody: { content: replyContent.trim() } }));
      setReplyContent('');
      await loadTicket();
    } catch (e: unknown) {
      setSendError(getErrorMessage(e, t('replyFailed')));
    } finally {
      setSending(false);
    }
  }

  // Close ticket
  const [closing, setClosing] = useState(false);

  async function handleClose() {
    if (!ticket) return;
    if (!confirm(t('closeConfirm'))) return;
    setClosing(true);
    try {
      await sessionApi(AdminService.adminCloseTicket({ id: Number(ticket.ticket!.id) }));
      loadTicket();
    } catch (e: unknown) {
      alert(getErrorMessage(e, t('closeFailed')));
    } finally {
      setClosing(false);
    }
  }

  // M3 circular loading indicator
  if (authLoading || loading) {
    return (
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
    );
  }

  if (error) {
    return (
      <div className="p-6 animate-fade-in">
        <div className="inline-flex items-center gap-2 rounded-xl bg-md-error-container text-md-on-error-container px-4 py-3 text-sm">
          <span className="size-2 rounded-full bg-md-error shrink-0" />
          {error}
        </div>
      </div>
    );
  }

  if (!ticket) return null;

  const isClosed = ticket.ticket?.status === 'closed';
  const statusKey = ticket.ticket?.status ?? '';

  return (
    <div className="p-6 space-y-5 max-w-3xl animate-fade-in">
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/tickets')}
          className="state-layer ripple inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5
            text-sm font-500 text-md-on-surface-variant hover:text-foreground
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
            transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{tCommon('back')}</span>
        </button>
      </div>

      {/* Ticket header card */}
      <Card className="bg-card border rounded-xl elevation-1 animate-slide-up">
        <CardHeader className="pb-4 pt-5 px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle className="font-display text-xl font-600 text-foreground leading-snug truncate">
                {ticket.ticket?.subject}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1 truncate">{ticket.ticket?.customer_email}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 pt-0.5">
              {/* M3 status chip */}
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-500 ${STATUS_CHIP[statusKey] ?? 'bg-muted text-muted-foreground'}`}>
                <span className={`size-1.5 rounded-full ${statusKey === 'open' ? 'bg-md-primary' : statusKey === 'replied' ? 'bg-[hsl(43_96%_50%)]' : 'bg-md-outline'}`} />
                {t(`status${statusKey.charAt(0).toUpperCase() + statusKey.slice(1)}`)}
              </span>
              {!isClosed && (
                <button
                  onClick={handleClose}
                  disabled={closing}
                  className="state-layer ripple inline-flex items-center justify-center rounded-lg px-3 py-1.5
                    text-xs font-500 border border-md-outline-variant
                    bg-md-surface-container text-foreground
                    disabled:opacity-50 disabled:pointer-events-none
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                    transition-colors"
                >
                  {closing ? tCommon('saving') : t('close')}
                </button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Conversation thread */}
      <div className="space-y-3">
        {(ticket.replies ?? []).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 animate-fade-in">
            <div className="size-12 rounded-full bg-md-surface-container-high flex items-center justify-center">
              <Send className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">{t('noReplies')}</p>
          </div>
        ) : (
          ticket.replies!.map((reply, i) => {
            const isAdmin = reply.is_admin === true;
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
                    <span className="text-xs font-500 opacity-80">{reply.author ?? ''}</span>
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

      {/* Reply compose */}
      {!isClosed && (
        <Card className="bg-card border rounded-xl animate-slide-up" style={{ animationDelay: '80ms' }}>
          <CardContent className="pt-5 pb-5 px-6 space-y-4">
            <Textarea
              placeholder={t('replyPlaceholder')}
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              rows={4}
              className="rounded-lg resize-none bg-md-surface-container-high border-md-outline-variant
                focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-0
                focus-visible:border-md-primary text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleReply();
              }}
            />
            {sendError && (
              <div className="flex items-center gap-2 rounded-lg bg-md-error-container text-md-on-error-container px-3 py-2 text-sm">
                <span className="size-1.5 rounded-full bg-md-error shrink-0" />
                {sendError}
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Ctrl+Enter {t('reply')}</span>
              <button
                onClick={handleReply}
                disabled={sending || !replyContent.trim()}
                className="state-layer ripple inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5
                  text-sm font-500 bg-md-primary text-md-on-primary elevation-1
                  disabled:opacity-50 disabled:pointer-events-none
                  hover:elevation-2 transition-shadow
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              >
                <Send className="h-4 w-4" />
                <span>{sending ? tCommon('saving') : t('reply')}</span>
              </button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
