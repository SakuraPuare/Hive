import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { handler_TicketDetailResponse, model_TicketReply } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';


function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'medium' });
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  replied: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-gray-100 text-gray-600',
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

  if (authLoading || loading) return <p className="p-6 text-sm text-muted-foreground">{tCommon('loading')}</p>;
  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!ticket) return null;

  const isClosed = ticket.ticket?.status === 'closed';

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/tickets')}>
          <ArrowLeft className="h-4 w-4 mr-1" />{tCommon('back')}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">{ticket.ticket?.subject}</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{ticket.ticket?.customer_email}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className={STATUS_COLORS[ticket.ticket?.status ?? ''] ?? ''}>
                {t(`status${(ticket.ticket?.status ?? '').charAt(0).toUpperCase() + (ticket.ticket?.status ?? '').slice(1)}`)}
              </Badge>
              {!isClosed && (
                <Button size="sm" variant="outline" onClick={handleClose} disabled={closing}>
                  {closing ? tCommon('saving') : t('close')}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="space-y-3">
        {(ticket.replies ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">{t('noReplies')}</p>
        ) : (
          ticket.replies!.map((reply) => {
            const isAdmin = reply.is_admin === true;
            return (
              <div key={reply.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-lg px-4 py-3 ${isAdmin ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium opacity-75">{reply.author ?? ''}</span>
                    <span className="text-xs opacity-50">{formatDate(reply.created_at ?? '')}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{reply.content}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {!isClosed && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <Textarea
              placeholder={t('replyPlaceholder')}
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              rows={4}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleReply();
              }}
            />
            {sendError && <p className="text-sm text-destructive">{sendError}</p>}
            <div className="flex justify-end">
              <Button onClick={handleReply} disabled={sending || !replyContent.trim()}>
                <Send className="h-4 w-4 mr-1" />
                {sending ? tCommon('saving') : t('reply')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
