import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Customer, model_CustomerSubscription, model_Plan } from '@/src/generated/client';
import { sessionApi, apiUrl } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { useClipboard } from '@/lib/use-clipboard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { ArrowLeft, Plus, Trash2, KeyRound, Copy, Link, RefreshCw, X, User } from 'lucide-react';
import { useTranslations } from 'next-intl';

// Backend returns plan_name via JOIN; extend the generated type locally
type Subscription = model_CustomerSubscription & { plan_name?: string };

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// M3 status chip classes per §10
const STATUS_CHIP: Record<string, string> = {
  active:    'bg-md-tertiary-container text-md-on-tertiary-container',
  suspended: 'bg-[hsl(43_96%_50%/0.15)] text-[hsl(38_92%_30%)] dark:text-[hsl(43_96%_70%)]',
  banned:    'bg-md-error-container text-md-on-error-container',
  expired:   'bg-muted text-muted-foreground',
};

// M3 status dot classes per §10
const STATUS_DOT: Record<string, string> = {
  active:    'bg-md-tertiary',
  suspended: 'bg-[hsl(43_96%_50%)]',
  banned:    'bg-md-error',
  expired:   'bg-md-outline',
};

export default function CustomerDetail() {
  const router = useRouter();
  const id = router.query.id as string | undefined;
  const t = useTranslations('customers');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const { user, loading: authLoading } = useCurrentUser();
  const fmt = useFormat();
  const { copied, copy: copyToClipboard } = useClipboard();

  const [customer, setCustomer] = useState<model_Customer | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [plans, setPlans] = useState<model_Plan[]>([]);
  const [plansError, setPlansError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit customer dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editNickname, setEditNickname] = useState('');
  const [editStatus, setEditStatus] = useState('active');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Reset password dialog
  const [pwdOpen, setPwdOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdError, setPwdError] = useState('');

  // Create subscription dialog
  const [subOpen, setSubOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [creatingSub, setCreatingSub] = useState(false);
  const [subError, setSubError] = useState('');

  // Destructive confirmations
  const [deletePendingSub, setDeletePendingSub] = useState<Subscription | null>(null);
  const [deletingSub, setDeletingSub] = useState(false);
  const [resetPendingSub, setResetPendingSub] = useState<Subscription | null>(null);
  const [resettingToken, setResettingToken] = useState(false);

  // Block-status confirmation (P2: AlertDialog for destructive status change)
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [pendingEditPayload, setPendingEditPayload] = useState<{ nickname: string; status: string } | null>(null);

  // Track which subscription's token or link was last copied
  const [lastCopiedSubId, setLastCopiedSubId] = useState<number | null>(null);
  const [lastCopiedType, setLastCopiedType] = useState<'token' | 'link' | null>(null);

  useEffect(() => {
    if (!authLoading && user && !user.can('customer:read')) {
      toast.error(t('noPermission'));
      router.replace('/dashboard');
    }
  }, [authLoading, user, router, toast, t]);

  const loadCustomer = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const detail = await sessionApi(AdminService.adminGetCustomer({ id: Number(id) }));
      setCustomer(detail.customer ?? null);
      setSubscriptions((detail.subscriptions ?? []) as Subscription[]);
    } catch (e) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { loadCustomer(); }, [loadCustomer]);

  // Load plans for create subscription dialog
  useEffect(() => {
    sessionApi(AdminService.adminListPlans())
      .then((p) => { setPlans(p); setPlansError(false); })
      .catch(() => setPlansError(true));
  }, []);

  function openEdit() {
    if (!customer) return;
    setEditNickname(customer.nickname ?? '');
    setEditStatus(customer.status ?? 'active');
    setEditError('');
    setEditOpen(true);
  }

  async function executeEdit(nickname: string, status: string) {
    if (!customer) return;
    setSaving(true);
    try {
      await sessionApi(AdminService.adminUpdateCustomer({
        id: customer.id!,
        requestBody: { nickname, status },
      }));
      setEditOpen(false);
      setPendingEditPayload(null);
      toast.success(t('customerUpdated'));
      loadCustomer();
    } catch (e) {
      setEditError(getErrorMessage(e, 'Update failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit() {
    if (!customer) return;
    const willBlock =
      (editStatus === 'banned' || editStatus === 'suspended') &&
      editStatus !== (customer?.status ?? 'active');
    if (willBlock) {
      // Intercept: show AlertDialog for destructive status change
      setPendingEditPayload({ nickname: editNickname, status: editStatus });
      setBlockConfirmOpen(true);
      return;
    }
    await executeEdit(editNickname, editStatus);
  }

  async function handleResetPassword() {
    if (!customer) return;
    setSavingPwd(true);
    try {
      await sessionApi(AdminService.adminResetCustomerPassword({
        id: customer.id!,
        requestBody: { password: newPwd },
      }));
      setPwdOpen(false);
      setNewPwd('');
      toast.success(t('passwordReset'));
    } catch (e) {
      setPwdError(getErrorMessage(e, 'Reset failed'));
    } finally {
      setSavingPwd(false);
    }
  }

  async function handleCreateSub() {
    if (!customer || !selectedPlan) return;
    setCreatingSub(true);
    try {
      await sessionApi(AdminService.adminCreateSubscription({
        id: customer.id!,
        requestBody: { plan_id: Number(selectedPlan) },
      }));
      setSubOpen(false);
      setSelectedPlan('');
      toast.success(t('subscriptionCreated'));
      loadCustomer();
    } catch (e) {
      setSubError(getErrorMessage(e, 'Create failed'));
    } finally {
      setCreatingSub(false);
    }
  }

  async function confirmResetToken() {
    const sub = resetPendingSub;
    if (!sub?.id) return;
    setResettingToken(true);
    try {
      await sessionApi(AdminService.adminResetSubscriptionToken({ id: sub.id }));
      setResetPendingSub(null);
      toast.success(t('tokenReset'));
      loadCustomer();
    } catch (e) {
      setResetPendingSub(null);
      toast.error(getErrorMessage(e, 'Reset token failed'));
    } finally {
      setResettingToken(false);
    }
  }

  async function confirmDeleteSub() {
    const sub = deletePendingSub;
    if (!sub?.id) return;
    setDeletingSub(true);
    try {
      await sessionApi(AdminService.adminDeleteSubscription({ id: sub.id }));
      setDeletePendingSub(null);
      toast.success(t('subscriptionDeleted'));
      loadCustomer();
    } catch (e) {
      setDeletePendingSub(null);
      toast.error(getErrorMessage(e, 'Delete failed'));
    } finally {
      setDeletingSub(false);
    }
  }

  async function copyToken(sub: Subscription) {
    const ok = await copyToClipboard(sub.token ?? '');
    if (ok) {
      setLastCopiedSubId(sub.id ?? null);
      setLastCopiedType('token');
      toast.success(t('copied'));
    }
  }

  async function copySubLink(sub: Subscription) {
    const url = apiUrl(`/s/${sub.token ?? ''}`);
    const ok = await copyToClipboard(url);
    if (ok) {
      setLastCopiedSubId(sub.id ?? null);
      setLastCopiedType('link');
      toast.success(t('copiedLink'));
    }
  }

  const statusLabel = (s: string) =>
    ({ active: t('active'), suspended: t('suspended'), banned: t('banned'), expired: t('expired') }[s] ?? s);

  const statusWillBlock =
    (editStatus === 'banned' || editStatus === 'suspended') &&
    editStatus !== (customer?.status ?? 'active');

  // M3 circular loading indicator
  if (authLoading || loading) {
    return (
      <div className="flex h-48 items-center justify-center" role="status" aria-live="polite">
        <span
          className="block size-10 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin"
          style={{ animationDuration: '800ms', animationTimingFunction: 'var(--ease-standard)' }}
          aria-hidden="true"
        />
        <span className="sr-only">{tCommon('loading')}</span>
      </div>
    );
  }

  return (
    <PageContainer width="content">
      {/* Back button */}
      <Button variant="ghost" onClick={() => router.back()} className="-ml-1">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span>{tCommon('back')}</span>
      </Button>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center gap-3 rounded-xl border border-md-error-container bg-md-error-container px-4 py-3 animate-slide-up"
        >
          <span className="size-2 shrink-0 rounded-full bg-md-error" aria-hidden="true" />
          <p className="flex-1 text-sm text-md-on-error-container">{error}</p>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setError('')}
            aria-label={tCommon('clear')}
            className="shrink-0 text-md-on-error-container hover:bg-md-error-container"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {customer && (
        <>
          {/* ── Page Header ── */}
          <PageHeader
            icon={<User />}
            title={customer.nickname || customer.email}
            description={
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 ${STATUS_CHIP[customer.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                <span className={`size-1.5 rounded-full ${STATUS_DOT[customer.status ?? ''] ?? 'bg-md-outline'}`} aria-hidden="true" />
                {statusLabel(customer.status ?? '')}
              </span>
            }
            actions={
              <>
                <Button variant="outline" onClick={() => { setNewPwd(''); setPwdError(''); setPwdOpen(true); }}>
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('resetPassword')}</span>
                </Button>
                <Button variant="outline" onClick={openEdit}>
                  <span>{tCommon('edit')}</span>
                </Button>
              </>
            }
          />

          {/* ── Customer Info Card ── */}
          <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '40ms' }}>
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-600 text-muted-foreground uppercase tracking-wide">
                {t('customerInfo')}
              </CardTitle>
            </CardHeader>

            <CardContent>
              <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
                {[
                  { label: t('email'), value: customer.email },
                  { label: t('nickname'), value: customer.nickname || '—' },
                  { label: t('colCreatedAt'), value: fmt.dateTime(customer.created_at) },
                  { label: 'ID', value: String(customer.id ?? '—') },
                ].map((item, i) => (
                  <div key={i} className="animate-slide-up" style={{ animationDelay: `${60 + i * 40}ms` }}>
                    <p className="text-xs font-500 text-muted-foreground mb-1">{item.label}</p>
                    <p className="text-sm font-500 text-foreground break-all">{item.value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          {/* ── Subscriptions Card ── */}
          <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '80ms' }}>
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div className="flex items-baseline gap-2">
                <CardTitle className="font-display text-base font-600 text-muted-foreground uppercase tracking-wide">
                  {t('subscriptions')}
                </CardTitle>
                {subscriptions.length > 0 && (
                  <span className="font-display text-2xl font-700 text-foreground">
                    {subscriptions.length}
                  </span>
                )}
              </div>
              <Button onClick={() => { setSubError(''); setSubOpen(true); }}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>{t('createSubscription')}</span>
              </Button>
            </CardHeader>

            <CardContent className="p-0">
              <Table aria-label={t('subscriptions')}>
                <TableHeader>
                  <TableRow className="border-b border-border hover:bg-transparent">
                    <TableHead className="text-xs font-500 text-muted-foreground pl-6">{t('planName')}</TableHead>
                    <TableHead className="text-xs font-500 text-muted-foreground">{t('token')}</TableHead>
                    <TableHead className="text-xs font-500 text-muted-foreground">{t('trafficUsed')}</TableHead>
                    <TableHead className="text-xs font-500 text-muted-foreground">{t('expiresAt')}</TableHead>
                    <TableHead className="text-xs font-500 text-muted-foreground">{t('colStatus')}</TableHead>
                    <TableHead className="text-xs font-500 text-muted-foreground text-right pr-6">{t('colActions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="py-16 text-center">
                        <div className="flex flex-col items-center gap-3 text-muted-foreground">
                          <div className="flex size-12 items-center justify-center rounded-full bg-md-surface-container-high">
                            <Plus className="h-5 w-5 text-md-on-surface-variant" aria-hidden="true" />
                          </div>
                          <p className="text-sm">{t('noSubscriptions')}</p>
                          <Button variant="outline" size="sm" onClick={() => setSubOpen(true)}>
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            <span>{t('createSubscription')}</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {subscriptions.map((sub, i) => {
                    const pct = (sub.traffic_limit ?? 0) > 0 ? Math.min(100, ((sub.traffic_used ?? 0) / (sub.traffic_limit ?? 1)) * 100) : 0;
                    const nearLimit = pct >= 90;
                    return (
                      <TableRow
                        key={sub.id}
                        className="hover-state border-b border-border last:border-0 animate-slide-up"
                        style={{ animationDelay: `${100 + i * 40}ms` }}
                      >
                        <TableCell className="pl-6 font-500 text-sm text-foreground">{sub.plan_name}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <code className="rounded-md bg-md-surface-container-high px-2 py-0.5 text-xs text-muted-foreground max-w-[120px] truncate">
                              {sub.token}
                            </code>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => copyToken(sub)}
                                  aria-label={t('copyToken')}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  <Copy className="h-3 w-3" aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('copyToken')}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => copySubLink(sub)}
                                  aria-label={t('copySubLink')}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  <Link className="h-3 w-3" aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('copySubLink')}</TooltipContent>
                            </Tooltip>
                            {copied && lastCopiedSubId === sub.id && lastCopiedType === 'token' && (
                              <span className="text-xs font-500 text-md-tertiary animate-fade-in">
                                {t('copied')}
                              </span>
                            )}
                            {copied && lastCopiedSubId === sub.id && lastCopiedType === 'link' && (
                              <span className="text-xs font-500 text-md-tertiary animate-fade-in">
                                {t('copied')}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div
                              role="progressbar"
                              aria-valuenow={Math.round(pct)}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${t('trafficUsed')} ${formatBytes(sub.traffic_used ?? 0)} / ${formatBytes(sub.traffic_limit ?? 0)}`}
                              className="h-1.5 w-24 overflow-hidden rounded-full bg-md-surface-container-highest"
                            >
                              <div
                                className={`h-full rounded-full transition-all ${nearLimit ? 'bg-[hsl(43_96%_50%)]' : 'bg-md-primary'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatBytes(sub.traffic_used ?? 0)} / {formatBytes(sub.traffic_limit ?? 0)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-foreground">
                          {fmt.date(sub.expires_at)}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 ${STATUS_CHIP[sub.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                            <span className={`size-1.5 rounded-full ${STATUS_DOT[sub.status ?? ''] ?? 'bg-md-outline'}`} aria-hidden="true" />
                            {statusLabel(sub.status ?? '')}
                          </span>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => setResetPendingSub(sub)}
                                  aria-label={t('resetToken')}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('resetToken')}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => setDeletePendingSub(sub)}
                                  aria-label={t('deleteSubscription')}
                                  className="text-md-error hover:bg-md-error-container"
                                >
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('deleteSubscription')}</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
      {/* ── Edit Customer Dialog ── */}
      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditError(''); }}>
        <DialogContent size="sm" pending={saving}>
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-600 text-foreground">
              {t('editCustomer')}
            </DialogTitle>
            <DialogDescription>{t('editCustomerDesc')}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (!saving) handleEdit(); }}
            className="space-y-4 py-2"
          >
            <div className="space-y-1.5">
              <Label htmlFor="edit-nickname" className="text-xs font-500 text-muted-foreground">{t('nickname')}</Label>
              <Input
                id="edit-nickname"
                value={editNickname}
                onChange={(e) => setEditNickname(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-status" className="text-xs font-500 text-muted-foreground">{t('status')}</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger id="edit-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('active')}</SelectItem>
                  <SelectItem value="suspended">{t('suspended')}</SelectItem>
                  <SelectItem value="banned">{t('banned')}</SelectItem>
                  <SelectItem value="expired">{t('expired')}</SelectItem>
                </SelectContent>
              </Select>
              {statusWillBlock && (
                <p className="text-xs text-md-error">{t('statusBlockWarning')}</p>
              )}
            </div>
            {editError && (
              <p className="text-xs text-md-error" role="alert">{editError}</p>
            )}
            <button type="submit" className="sr-only" tabIndex={-1} />
          </form>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleEdit} loading={saving}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Password Dialog ── */}
      <Dialog open={pwdOpen} onOpenChange={(o) => { setPwdOpen(o); if (!o) setPwdError(''); }}>
        <DialogContent size="sm" pending={savingPwd}>
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-600 text-foreground">
              {t('resetPassword')}
            </DialogTitle>
            <DialogDescription>{t('resetPasswordDesc')}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => { e.preventDefault(); if (!savingPwd && newPwd) handleResetPassword(); }}
            className="py-2 space-y-1.5"
          >
            <Label htmlFor="reset-password" className="text-xs font-500 text-muted-foreground">{t('newPassword')}</Label>
            <Input
              id="reset-password"
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              required
              aria-required="true"
              autoComplete="new-password"
              autoFocus
              passwordToggleLabel={t('togglePasswordVisibility')}
            />
            {pwdError && (
              <p className="text-xs text-md-error" role="alert">{pwdError}</p>
            )}
            <button type="submit" className="sr-only" tabIndex={-1} />
          </form>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setPwdOpen(false)} disabled={savingPwd}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleResetPassword} loading={savingPwd} disabled={!newPwd}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create Subscription Dialog ── */}
      <Dialog open={subOpen} onOpenChange={(o) => { setSubOpen(o); if (!o) setSubError(''); }}>
        <DialogContent size="sm" pending={creatingSub}>
          <DialogHeader>
            <DialogTitle className="font-display text-lg font-600 text-foreground">
              {t('createSubscription')}
            </DialogTitle>
            <DialogDescription>{t('createSubscriptionDesc')}</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-1.5">
            <Label htmlFor="sub-plan" className="text-xs font-500 text-muted-foreground">{t('selectPlan')}</Label>
            <Select value={selectedPlan} onValueChange={setSelectedPlan}>
              <SelectTrigger id="sub-plan" aria-required="true" disabled={plans.length === 0}>
                <SelectValue placeholder={plansError ? t('plansLoadFailed') : t('selectPlan')} />
              </SelectTrigger>
              <SelectContent emptyLabel={plansError ? t('plansLoadFailed') : t('noPlans')}>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {subError && (
              <p className="text-xs text-md-error" role="alert">{subError}</p>
            )}
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setSubOpen(false)} disabled={creatingSub}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleCreateSub} loading={creatingSub} disabled={!selectedPlan}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Token Confirm ── */}
      <AlertDialog open={!!resetPendingSub} onOpenChange={(o) => { if (!o) setResetPendingSub(null); }}>
        <AlertDialogContent pending={resettingToken}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('resetToken')}</AlertDialogTitle>
            <AlertDialogDescription>{t('resetTokenConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resettingToken}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={(e) => { e.preventDefault(); confirmResetToken(); }}
              loading={resettingToken}
              loadingLabel={tCommon('saving')}
            >
              {t('resetToken')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete Subscription Confirm ── */}
      <AlertDialog open={!!deletePendingSub} onOpenChange={(o) => { if (!o) setDeletePendingSub(null); }}>
        <AlertDialogContent pending={deletingSub}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-md-error">{t('deleteSubscription')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteSubscriptionConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSub}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={(e) => { e.preventDefault(); confirmDeleteSub(); }}
              loading={deletingSub}
              loadingLabel={tCommon('saving')}
            >
              {t('confirmDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Block/Suspend Status Confirm (P2) ── */}
      <AlertDialog open={blockConfirmOpen} onOpenChange={(o) => { if (!o) { setBlockConfirmOpen(false); setPendingEditPayload(null); } }}>
        <AlertDialogContent pending={saving}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('blockStatusConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('blockStatusConfirmDesc', { email: customer?.email ?? '', status: pendingEditPayload?.status ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={(e) => {
                e.preventDefault();
                if (pendingEditPayload) {
                  setBlockConfirmOpen(false);
                  executeEdit(pendingEditPayload.nickname, pendingEditPayload.status);
                }
              }}
              loading={saving}
              loadingLabel={tCommon('saving')}
            >
              {tCommon('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
