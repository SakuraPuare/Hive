import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Customer } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { RefreshCw, Plus, Trash2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

// M3 §10 status chip classes
const STATUS_CHIP: Record<string, string> = {
  active:
    'bg-md-tertiary-container text-md-on-tertiary-container',
  suspended:
    'bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]',
  banned:
    'bg-md-error-container text-md-on-error-container',
};

// M3 §10 status dot classes
const STATUS_DOT: Record<string, string> = {
  active: 'bg-md-tertiary',
  suspended: 'bg-[hsl(43_96%_50%)]',
  banned: 'bg-md-error',
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
    } catch (e) {
      setError(getErrorMessage(e, t('loadFailed')));
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
    } catch (e) {
      setError(getErrorMessage(e, 'Create failed'));
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
    } catch (e) {
      setError(getErrorMessage(e, 'Delete failed'));
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const statusLabel = (s: string) =>
    ({ active: t('active'), suspended: t('suspended'), banned: t('banned') }[s] ?? s);

  if (authLoading) return null;

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-md-primary-container text-md-on-primary-container">
            <Users className="size-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-600 text-foreground leading-tight">
              {t('title')}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {total > 0 && `${total} 条记录`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={loadCustomers}
            className="state-layer ripple inline-flex items-center justify-center size-9
              rounded-lg border border-border bg-card text-muted-foreground
              hover:text-foreground focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-ring focus-visible:ring-offset-2
              transition-colors"
            aria-label="刷新"
          >
            <RefreshCw className="size-4" />
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            className="state-layer ripple inline-flex items-center gap-1.5
              rounded-lg px-4 py-2 text-sm font-500
              bg-md-primary text-md-on-primary elevation-1
              focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Plus className="size-4" />
            {t('createCustomer')}
          </button>
        </div>
      </div>

      {/* ── Filters toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 p-4 bg-card border rounded-xl animate-slide-up">
        <Input
          placeholder={t('searchPlaceholder')}
          value={emailFilter}
          onChange={(e) => { setEmailFilter(e.target.value); setPage(1); }}
          className="max-w-xs rounded-lg bg-md-surface-container-high border-border
            focus-visible:ring-ring text-sm"
        />
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === '__all__' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-36 rounded-lg bg-md-surface-container-high border-border text-sm">
            <SelectValue placeholder={tCommon('all')} />
          </SelectTrigger>
          <SelectContent className="rounded-xl bg-popover border-border">
            <SelectItem value="__all__">{tCommon('all')}</SelectItem>
            <SelectItem value="active">{t('active')}</SelectItem>
            <SelectItem value="suspended">{t('suspended')}</SelectItem>
            <SelectItem value="banned">{t('banned')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl
          bg-md-error-container text-md-on-error-container text-sm animate-slide-up">
          <span className="size-1.5 rounded-full bg-md-error shrink-0" />
          {error}
        </div>
      )}

      {/* ── Table card ── */}
      <div className="bg-card border rounded-xl overflow-hidden animate-slide-up"
        style={{ animationDelay: '60ms' }}>

        {/* Loading overlay */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <span
              className="size-10 rounded-full border-4 border-md-primary-container
                border-t-md-primary animate-spin"
              style={{ animationDuration: '0.75s' }}
              aria-label="加载中"
            />
          </div>
        )}

        {!loading && (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3 pl-5">
                  {t('colEmail')}
                </TableHead>
                <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
                  {t('colNickname')}
                </TableHead>
                <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
                  {t('colStatus')}
                </TableHead>
                <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3">
                  {t('colCreatedAt')}
                </TableHead>
                <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground py-3 pr-5 text-right">
                  {t('colActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.length === 0 && (
                <TableRow className="border-0">
                  <TableCell colSpan={5} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                        <Users className="size-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground">{t('noCustomers')}</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {customers.map((c, i) => (
                <TableRow
                  key={c.id}
                  className="hover-state cursor-pointer border-border animate-slide-up"
                  style={{ animationDelay: `${80 + i * 40}ms` }}
                  onClick={() => router.push(`/customers/${c.id}`)}
                >
                  <TableCell className="py-3.5 pl-5 font-mono text-sm text-foreground">
                    {c.email}
                  </TableCell>
                  <TableCell className="py-3.5 text-sm text-muted-foreground">
                    {c.nickname || '—'}
                  </TableCell>
                  <TableCell className="py-3.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500
                      ${STATUS_CHIP[c.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                      <span className={`size-1.5 rounded-full shrink-0
                        ${STATUS_DOT[c.status ?? ''] ?? 'bg-md-outline'}`} />
                      {statusLabel(c.status ?? '')}
                    </span>
                  </TableCell>
                  <TableCell className="py-3.5 text-sm text-muted-foreground">
                    {c.created_at ? formatDate(c.created_at) : '—'}
                  </TableCell>
                  <TableCell className="py-3.5 pr-5 text-right">
                    <button
                      className="state-layer inline-flex items-center justify-center size-8
                        rounded-lg text-muted-foreground hover:text-md-error
                        focus-visible:outline-none focus-visible:ring-2
                        focus-visible:ring-ring focus-visible:ring-offset-1
                        transition-colors"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }}
                      aria-label="删除"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-3 animate-slide-up"
          style={{ animationDelay: '120ms' }}>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded-lg border-border text-sm"
          >
            {t('prevPage')}
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="rounded-lg border-border text-sm"
          >
            {t('nextPage')}
          </Button>
        </div>
      )}

      {/* ── Create Dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-2xl bg-md-surface-container elevation-3 border-border max-w-md">
          <DialogHeader className="pb-1">
            <DialogTitle className="font-display text-lg font-600 text-foreground">
              {t('createCustomer')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('email')}
              </Label>
              <Input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="rounded-lg bg-md-surface-container-high border-border focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('password')}
              </Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="rounded-lg bg-md-surface-container-high border-border focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('nickname')}
              </Label>
              <Input
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
                className="rounded-lg bg-md-surface-container-high border-border focus-visible:ring-ring"
              />
            </div>
          </div>
          <DialogFooter className="pt-2 gap-2">
            <button
              onClick={() => setCreateOpen(false)}
              className="state-layer inline-flex items-center justify-center px-4 py-2 text-sm font-500
                rounded-lg border border-border bg-transparent text-foreground
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !newEmail || !newPassword}
              className="state-layer ripple inline-flex items-center justify-center px-5 py-2 text-sm font-500
                rounded-lg bg-md-primary text-md-on-primary elevation-1
                disabled:opacity-40 disabled:cursor-not-allowed
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {creating ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="rounded-2xl bg-md-surface-container elevation-3 border-border max-w-sm">
          <DialogHeader className="pb-1">
            <DialogTitle className="font-display text-lg font-600 text-foreground">
              {tCommon('delete')}
            </DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground leading-relaxed">
            {t('deleteConfirm', { email: deleteTarget?.email ?? '' })}
          </p>
          <DialogFooter className="pt-2 gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="state-layer inline-flex items-center justify-center px-4 py-2 text-sm font-500
                rounded-lg border border-border bg-transparent text-foreground
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleDelete}
              className="state-layer ripple inline-flex items-center justify-center px-5 py-2 text-sm font-500
                rounded-lg bg-md-error text-md-on-error
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              {tCommon('delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
