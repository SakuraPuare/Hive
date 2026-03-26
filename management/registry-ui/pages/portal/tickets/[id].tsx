import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import { PortalService } from '@/src/generated/client';
import { portalSessionApi } from '@/lib/openapi-session';
import type { handler_PortalTicketDetail } from '@/src/generated/client/models/handler_PortalTicketDetail';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Send } from 'lucide-react';


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
      loadTicket();
    } catch (e: any) {
      setSendError(e?.error || t('replyFailed'));
    } finally {
      setSending(false);
    }
  }

  if (authLoading || loading) return <p className="p-6 text-sm text-muted-foreground">{tCommon('loading')}</p>;
  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!ticket) return null;

  const tk = ticket.ticket!;
  const isClosed = tk.status === 'closed';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/portal/tickets')}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          {tCommon('back')}
        </Button>
        <h1 className="text-lg font-semibold flex-1">#{tk.id} {tk.subject}</h1>
        <Badge variant="outline" className={STATUS_COLORS[tk.status ?? ''] ?? ''}>
          {t(`status${(tk.status ?? '').charAt(0).toUpperCase() + (tk.status ?? '').slice(1)}` as any)}
        </Badge>
      </div>

      {/* Replies */}
      <div className="space-y-3 min-h-[200px]">
        {(!ticket.replies || ticket.replies.length === 0) ? (
          <p className="text-center text-sm text-muted-foreground py-8">{t('noReplies')}</p>
        ) : (
          ticket.replies.map((reply) => {
            const isAdmin = reply.is_admin;
            return (
              <div key={reply.id} className={`flex ${isAdmin ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[75%] rounded-lg px-4 py-3 ${isAdmin ? 'bg-muted' : 'bg-primary text-primary-foreground'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium opacity-75">{reply.author}</span>
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
