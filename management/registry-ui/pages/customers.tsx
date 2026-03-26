import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Customer } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RefreshCw, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-yellow-100 text-yellow-800',
  banned: 'bg-red-100 text-red-800',
};

export default function CustomersPage() {
  const t = useTranslations('customers');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { user, loading: authLoading } = useCurrentUser();

  const [customers, setCustomers] = useState<model_Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [page, setPage] = useState(1);
  const limit = 20;
  const [emailFilter, setEmailFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newNickname, setNewNickname] = useState('');
  const [creating, setCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<model_Customer | null>(null);

  useEffect(() => {
    if (!authLoading && user && !user.can('customer:read')) {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await sessionApi(AdminService.adminListCustomers({
        status: statusFilter !== 'all' ? statusFilter || undefined : undefined,
        email: emailFilter || undefined,
        page: page,
        limit: 20,
      }));
      setCustomers(data?.items ?? []);
      setTotal(data?.total ?? 0);
    } catch (e: any) {
      setError(e?.error || t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, emailFilter, statusFilter, t]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  async function handleCreate() {
    setCreating(true);
    try {
      await sessionApi(AdminService.adminCreateCustomer({
        requestBody: { email: newEmail, password: newPassword, nickname: newNickname || undefined },
      }));
      setCreateOpen(false);
      setNewEmail('');
      setNewPassword('');
      setNewNickname('');
      loadCustomers();
    } catch (e: any) {
      setError(e?.error || 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await sessionApi(AdminService.adminDeleteCustomer({ id: deleteTarget.id! }));
      setDeleteTarget(null);
      loadCustomers();
    } catch (e: any) {
      setError(e?.error || 'Delete failed');
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const statusLabel = (s: string) =>
    ({ active: t('active'), suspended: t('suspended'), banned: t('banned') }[s] ?? s);

  if (authLoading) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={loadCustomers}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />{t('createCustomer')}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Input
          placeholder={t('searchPlaceholder')}
          value={emailFilter}
          onChange={(e) => { setEmailFilter(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === '__all__' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder={tCommon('all')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{tCommon('all')}</SelectItem>
            <SelectItem value="active">{t('active')}</SelectItem>
            <SelectItem value="suspended">{t('suspended')}</SelectItem>
            <SelectItem value="banned">{t('banned')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('colEmail')}</TableHead>
            <TableHead>{t('colNickname')}</TableHead>
            <TableHead>{t('colStatus')}</TableHead>
            <TableHead>{t('colCreatedAt')}</TableHead>
            <TableHead className="text-right">{t('colActions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!loading && customers.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                {t('noCustomers')}
              </TableCell>
            </TableRow>
          )}
          {customers.map((c) => (
            <TableRow
              key={c.id}
              className="cursor-pointer"
              onClick={() => router.push(`/customers/${c.id}`)}
            >
              <TableCell className="font-mono text-sm">{c.email}</TableCell>
              <TableCell>{c.nickname || '—'}</TableCell>
              <TableCell>
                <Badge variant="outline" className={STATUS_COLORS[c.status ?? ''] ?? ''}>
                  {statusLabel(c.status ?? '')}
                </Badge>
              </TableCell>
              <TableCell>{c.created_at ? formatDate(c.created_at) : '—'}</TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('prevPage')}
          </Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            {t('nextPage')}
          </Button>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createCustomer')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{t('email')}</Label>
              <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </div>
            <div>
              <Label>{t('password')}</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div>
              <Label>{t('nickname')}</Label>
              <Input value={newNickname} onChange={(e) => setNewNickname(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{tCommon('cancel')}</Button>
            <Button onClick={handleCreate} disabled={creating || !newEmail || !newPassword}>
              {creating ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCommon('delete')}</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm">{t('deleteConfirm', { email: deleteTarget?.email ?? '' })}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{tCommon('cancel')}</Button>
            <Button variant="destructive" onClick={handleDelete}>{tCommon('delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
