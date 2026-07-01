import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RefreshCw, Plus, Trash2, Users, ChevronRight, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
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
  const toast = useToast();
  const { user, loading: authLoading } = useCurrentUser();
  const canWrite = user?.can('customer:write') ?? false;

  const [customers, setCustomers] = useState<model_Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [page, setPage] = useState(1);
  const limit = 20;
  // emailFilter is debounced by the Input primitive (debounceMs) — it only
  // updates after the user stops typing, so it is safe as a load dependency.
  const [emailFilter, setEmailFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newNickname, setNewNickname] = useState('');
  const [creating, setCreating] = useState(false);
  const [formErrors, setFormErrors] = useState<{ email?: string; password?: string }>({});

  const [deleteTarget, setDeleteTarget] = useState<model_Customer | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!authLoading && user && !user.can('customer:read')) {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  const hasActiveFilters = emailFilter.length > 0 || statusFilter !== 'all';

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await sessionApi(AdminService.adminListCustomers({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        email: emailFilter || undefined,
        page: page,
        limit: 20,
      }));
      setCustomers(data?.items ?? []);
      setTotal(data?.total ?? 0);
      setError('');
    } catch (e) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [page, emailFilter, statusFilter, t]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  function resetCreateForm() {
    setNewEmail('');
    setNewPassword('');
    setNewNickname('');
    setFormErrors({});
  }

  function validateCreate() {
    const errs: { email?: string; password?: string } = {};
    if (!newEmail) errs.email = t('emailRequired');
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) errs.email = t('emailInvalid');
    if (!newPassword) errs.password = t('passwordRequired');
    else if (newPassword.length < 8) errs.password = t('passwordMinLength');
    return errs;
  }

  async function handleCreate(e?: React.FormEvent) {
    e?.preventDefault();
    const errs = validateCreate();
    setFormErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setCreating(true);
    try {
      await sessionApi(AdminService.adminCreateCustomer({
        requestBody: { email: newEmail, password: newPassword, nickname: newNickname || undefined },
      }));
      setCreateOpen(false);
      resetCreateForm();
      toast.success(t('customerCreated'));
      loadCustomers();
    } catch (err) {
      toast.error(getErrorMessage(err, t('createFailed')));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await sessionApi(AdminService.adminDeleteCustomer({ id: deleteTarget.id! }));
      toast.success(t('customerDeleted'));
      setDeleteTarget(null);
      loadCustomers();
    } catch (e) {
      toast.error(getErrorMessage(e, t('deleteFailed')));
    } finally {
      setDeleting(false);
    }
  }

  function clearFilters() {
    setEmailFilter('');
    setStatusFilter('all');
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const statusLabel = (s: string) =>
    ({ active: t('active'), suspended: t('suspended'), banned: t('banned') }[s] ?? s);

  if (authLoading) return null;

  return (
    <TooltipProvider>
    <div className="space-y-6 animate-fade-in">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-md-primary-container text-md-on-primary-container">
            <Users className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-xl font-600 text-foreground leading-tight">
              {t('title')}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {total > 0 && t('recordCount', { count: total })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={loadCustomers}
                disabled={loading}
                aria-label={tCommon('refresh')}
              >
                <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tCommon('refresh')}</TooltipContent>
          </Tooltip>
          {canWrite && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              {t('createCustomer')}
            </Button>
          )}
        </div>
      </div>

      {/* ── Filters toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 p-4 bg-card border rounded-xl animate-slide-up">
        <Input
          aria-label={t('searchPlaceholder')}
          placeholder={t('searchPlaceholder')}
          defaultValue={emailFilter}
          debounceMs={350}
          clearable
          clearLabel={tCommon('clear')}
          onValueChange={(v) => { setEmailFilter(v); setPage(1); }}
          className="max-w-xs"
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
        >
          <SelectTrigger className="w-36" aria-label={t('colStatus')}>
            <SelectValue placeholder={tCommon('all')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tCommon('all')}</SelectItem>
            <SelectItem value="active">{t('active')}</SelectItem>
            <SelectItem value="suspended">{t('suspended')}</SelectItem>
            <SelectItem value="banned">{t('banned')}</SelectItem>
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="size-4" aria-hidden="true" />
            {tCommon('clear')}
          </Button>
        )}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 px-4 py-3 rounded-xl
          bg-md-error-container text-md-on-error-container text-sm animate-slide-up"
        >
          <span className="size-1.5 rounded-full bg-md-error shrink-0" aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setError('')}
                aria-label={tCommon('clear')}
                className="text-md-on-error-container hover:text-md-on-error-container -mr-1"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tCommon('clear')}</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* ── Table card ── */}
      <div className="bg-card border rounded-xl overflow-hidden animate-slide-up"
        style={{ animationDelay: '60ms' }}>

        {/* Loading overlay */}
        {loading && (
          <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
            <span
              className="size-10 rounded-full border-4 border-md-primary-container
                border-t-md-primary animate-spin"
              style={{ animationDuration: '0.75s' }}
              aria-hidden="true"
            />
            <span className="sr-only">{tCommon('loading')}</span>
          </div>
        )}

        {!loading && (
          <Table aria-label={t('title')}>
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
                        <Users className="size-6 text-muted-foreground" aria-hidden="true" />
                      </div>
                      {hasActiveFilters ? (
                        <>
                          <p className="text-sm text-muted-foreground">{t('noMatchingCustomers')}</p>
                          <Button variant="ghost" size="sm" onClick={clearFilters}>
                            <X className="size-4" aria-hidden="true" />
                            {t('clearFilters')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-muted-foreground">{t('noCustomers')}</p>
                          {canWrite && (
                            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                              <Plus className="size-4" aria-hidden="true" />
                              {t('createFirstCustomer')}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {customers.map((c, i) => (
                <TableRow
                  key={c.id}
                  className="hover-state border-border animate-slide-up focus-within:bg-md-surface-container-high"
                  style={{ animationDelay: `${80 + i * 40}ms` }}
                >
                  <TableCell className="py-3.5 pl-5 font-mono text-sm">
                    <Link
                      href={`/customers/${c.id}`}
                      className="group inline-flex items-center gap-1.5 text-foreground rounded-md
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
                        hover:text-md-primary transition-colors"
                    >
                      {c.email}
                      <ChevronRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                    </Link>
                  </TableCell>
                  <TableCell className="py-3.5 text-sm text-muted-foreground">
                    {c.nickname || '—'}
                  </TableCell>
                  <TableCell className="py-3.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500
                      ${STATUS_CHIP[c.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                      <span className={`size-1.5 rounded-full shrink-0
                        ${STATUS_DOT[c.status ?? ''] ?? 'bg-md-outline'}`} aria-hidden="true" />
                      {statusLabel(c.status ?? '')}
                    </span>
                  </TableCell>
                  <TableCell className="py-3.5 text-sm text-muted-foreground">
                    {c.created_at ? formatDate(c.created_at) : '—'}
                  </TableCell>
                  <TableCell className="py-3.5 pr-5 text-right">
                    {canWrite && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-md-error"
                            onClick={() => setDeleteTarget(c)}
                            aria-label={t('deleteCustomerLabel', { email: c.email ?? '' })}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('deleteCustomer')}</TooltipContent>
                      </Tooltip>
                    )}
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
          >
            {t('prevPage')}
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            {t('nextPage')}
          </Button>
        </div>
      )}

      {/* ── Create Dialog ── */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (creating) return;
          setCreateOpen(open);
          if (!open) resetCreateForm();
        }}
      >
        <DialogContent size="sm" pending={creating}>
          <DialogHeader className="pb-1">
            <DialogTitle className="font-display text-lg font-600 text-foreground">
              {t('createCustomer')}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="create-email" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('email')} <span className="text-md-error" aria-hidden="true">*</span>
              </Label>
              <Input
                id="create-email"
                type="email"
                autoFocus
                autoComplete="email"
                aria-required="true"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                error={formErrors.email}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-password" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('password')} <span className="text-md-error" aria-hidden="true">*</span>
              </Label>
              <Input
                id="create-password"
                type="password"
                autoComplete="new-password"
                aria-required="true"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                error={formErrors.password}
                helperText={formErrors.password ? undefined : t('passwordHint')}
                passwordToggleLabel={t('togglePassword')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-nickname" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('nickname')}
              </Label>
              <Input
                id="create-nickname"
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
              />
            </div>
            <DialogFooter className="pt-2 gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={creating}
                onClick={() => { setCreateOpen(false); resetCreateForm(); }}
              >
                {tCommon('cancel')}
              </Button>
              <Button type="submit" loading={creating}>
                {tCommon('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ── */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}
      >
        <AlertDialogContent pending={deleting}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteCustomer')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm', { email: deleteTarget?.email ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {tCommon('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={deleting}
              loadingLabel={tCommon('saving')}
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
    </TooltipProvider>
  );
}
