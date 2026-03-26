import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useCustomer } from '@/lib/portal-auth';
import { API_PREFIX } from '@/lib/openapi-session';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { RefreshCw, Plus } from 'lucide-react';

type Ticket = {
  id: number;
  subject: string;
  status: string;
  created_at: string;
};

function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800',
  replied: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-gray-100 text-gray-600',
};

export default function PortalTicketsPage() {
  const t = useTranslations('portal');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { customer, loading: authLoading } = useCustomer();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_PREFIX}/portal/tickets`, { credentials: 'include' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTickets(data.items ?? data ?? []);
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
      const res = await fetch(`${API_PREFIX}/portal/tickets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: newSubject.trim(), content: newContent.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw { error: body.error || t('submitFailed') };
      }
      setShowNew(false);
      setNewSubject('');
      setNewContent('');
      loadTickets();
    } catch (e: any) {
      setSubmitError(e?.error || t('submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) return <p className="p-6 text-sm text-muted-foreground">{tCommon('loading')}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('ticketsTitle')}</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-1" />
            {t('newTicket')}
          </Button>
          <Button variant="outline" size="sm" onClick={loadTickets} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {tCommon('refresh')}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">{t('colId')}</TableHead>
              <TableHead>{t('colSubject')}</TableHead>
              <TableHead>{t('colStatus')}</TableHead>
              <TableHead>{t('colCreatedAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">{tCommon('loading')}</TableCell>
              </TableRow>
            ) : tickets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">{t('noTickets')}</TableCell>
              </TableRow>
            ) : (
              tickets.map((ticket) => (
                <TableRow
                  key={ticket.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/portal/tickets/${ticket.id}`)}
                >
                  <TableCell className="text-muted-foreground">#{ticket.id}</TableCell>
                  <TableCell className="font-medium">{ticket.subject}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_COLORS[ticket.status] ?? ''}>
                      {t(`status${ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1)}` as any)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(ticket.created_at)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* New ticket dialog */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('newTicket')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t('subject')}</Label>
              <Input
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                placeholder={t('subjectPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('content')}</Label>
              <Textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder={t('contentPlaceholder')}
                rows={5}
              />
            </div>
            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>{tCommon('cancel')}</Button>
            <Button onClick={handleSubmit} disabled={submitting || !newSubject.trim() || !newContent.trim()}>
              {submitting ? t('submitting') : t('submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
