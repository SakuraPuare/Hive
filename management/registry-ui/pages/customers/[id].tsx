import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Customer, model_CustomerSubscription, model_Plan } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ArrowLeft, Plus, Trash2, KeyRound, Copy, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

// Backend returns plan_name via JOIN; extend the generated type locally
type Subscription = model_CustomerSubscription & { plan_name?: string };

function formatDate(s: string | null | undefined) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

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
  const { user, loading: authLoading } = useCurrentUser();

  const [customer, setCustomer] = useState<model_Customer | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [plans, setPlans] = useState<model_Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit customer dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editNickname, setEditNickname] = useState('');
  const [editStatus, setEditStatus] = useState('active');
  const [saving, setSaving] = useState(false);

  // Reset password dialog
  const [pwdOpen, setPwdOpen] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  // Create subscription dialog
  const [subOpen, setSubOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [creatingSub, setCreatingSub] = useState(false);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && user && !user.can('customer:read')) {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

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
    sessionApi(AdminService.adminListPlans()).then(setPlans).catch(() => {});
  }, []);

  function openEdit() {
    if (!customer) return;
    setEditNickname(customer.nickname ?? '');
    setEditStatus(customer.status ?? 'active');
    setEditOpen(true);
  }

  async function handleEdit() {
    if (!customer) return;
    setSaving(true);
    try {
      await sessionApi(AdminService.adminUpdateCustomer({
        id: customer.id!,
        requestBody: { nickname: editNickname, status: editStatus },
      }));
      setEditOpen(false);
      loadCustomer();
    } catch (e) {
      setError(getErrorMessage(e, 'Update failed'));
    } finally {
      setSaving(false);
    }
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
    } catch (e) {
      setError(getErrorMessage(e, 'Reset failed'));
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
      loadCustomer();
    } catch (e) {
      setError(getErrorMessage(e, 'Create failed'));
    } finally {
      setCreatingSub(false);
    }
  }

  async function handleResetToken(subId: number) {
    try {
      await sessionApi(AdminService.adminResetSubscriptionToken({ id: subId }));
      loadCustomer();
    } catch (e) {
      setError(getErrorMessage(e, 'Reset token failed'));
    }
  }

  async function handleDeleteSub(subId: number) {
    try {
      await sessionApi(AdminService.adminDeleteSubscription({ id: subId }));
      loadCustomer();
    } catch (e) {
      setError(getErrorMessage(e, 'Delete failed'));
    }
  }

  function copyToken(sub: Subscription) {
    navigator.clipboard.writeText(sub.token ?? '');
    setCopiedId(sub.id ?? null);
    setTimeout(() => setCopiedId(null), 1500);
  }

  const statusLabel = (s: string) =>
    ({ active: t('active'), suspended: t('suspended'), banned: t('banned'), expired: t('expired') }[s] ?? s);

  // M3 circular loading indicator
  if (authLoading || loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <span
          className="block size-10 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin"
          style={{ animationDuration: '800ms', animationTimingFunction: 'var(--ease-standard)' }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back button */}
      <button
        onClick={() => router.push('/customers')}
        className="state-layer ripple inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5
          text-sm font-500 text-md-on-surface-variant
          hover:bg-md-surface-container-high
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
          transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>{tCommon('back')}</span>
      </button>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-md-error-container bg-md-error-container px-4 py-3 animate-slide-up">
          <span className="size-2 shrink-0 rounded-full bg-md-error" />
          <p className="text-sm text-md-on-error-container">{error}</p>
        </div>
      )}

      {customer && (
        <>
          {/* ── Customer Info Card ── */}
          <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '40ms' }}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 pb-4">
              <div className="space-y-1">
                <p className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                  {t('customerInfo')}
                </p>
                <CardTitle className="font-display text-xl font-600 text-foreground">
                  {customer.nickname || customer.email}
                </CardTitle>
                {/* Status chip inline with title */}
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 ${STATUS_CHIP[customer.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                  <span className={`size-1.5 rounded-full ${STATUS_DOT[customer.status ?? ''] ?? 'bg-md-outline'}`} />
                  {statusLabel(customer.status ?? '')}
                </span>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => { setNewPwd(''); setPwdOpen(true); }}
                  className="state-layer ripple inline-flex items-center gap-1.5 rounded-lg px-3 py-2
                    text-sm font-500 border border-border bg-card text-foreground
                    hover:bg-md-surface-container-high
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                    transition-colors"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>{t('resetPassword')}</span>
                </button>
                <button
                  onClick={openEdit}
                  className="state-layer ripple inline-flex items-center gap-1.5 rounded-lg px-3 py-2
                    text-sm font-500 border border-border bg-card text-foreground
                    hover:bg-md-surface-container-high
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                    transition-colors"
                >
                  <span>{tCommon('edit')}</span>
                </button>
              </div>
            </CardHeader>

            <CardContent>
              <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
                {[
                  { label: t('email'), value: customer.email },
                  { label: t('nickname'), value: customer.nickname || '—' },
                  { label: t('colCreatedAt'), value: formatDate(customer.created_at) },
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
              <div className="space-y-0.5">
                <p className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                  {t('subscriptions')}
                </p>
                <CardTitle className="font-display text-xl font-600 text-foreground">
                  {subscriptions.length > 0 && (
                    <span className="font-display text-3xl font-700 text-foreground mr-1">
                      {subscriptions.length}
                    </span>
                  )}
                  {t('subscriptions')}
                </CardTitle>
              </div>
              <button
                onClick={() => setSubOpen(true)}
                className="state-layer ripple inline-flex items-center gap-2 rounded-lg px-4 py-2
                  text-sm font-500 bg-md-primary text-md-on-primary elevation-1
                  hover:elevation-2
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                  transition-shadow"
              >
                <Plus className="h-4 w-4" />
                <span>{t('createSubscription')}</span>
              </button>
            </CardHeader>

            <CardContent className="p-0">
              <Table>
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
                            <Plus className="h-5 w-5 text-md-on-surface-variant" />
                          </div>
                          <p className="text-sm">{t('noSubscriptions')}</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {subscriptions.map((sub, i) => {
                    const pct = (sub.traffic_limit ?? 0) > 0 ? Math.min(100, ((sub.traffic_used ?? 0) / (sub.traffic_limit ?? 1)) * 100) : 0;
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
                            <button
                              onClick={() => copyToken(sub)}
                              className="state-layer inline-flex size-6 items-center justify-center rounded-md
                                text-muted-foreground hover:text-foreground
                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary
                                transition-colors"
                              title="Copy token"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                            {copiedId === sub.id && (
                              <span className="text-xs font-500 text-md-tertiary animate-fade-in">
                                {t('copied')}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-md-surface-container-highest">
                              <div
                                className="h-full rounded-full bg-md-primary transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatBytes(sub.traffic_used ?? 0)} / {formatBytes(sub.traffic_limit ?? 0)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-foreground">{formatDate(sub.expires_at)}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 ${STATUS_CHIP[sub.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>
                            <span className={`size-1.5 rounded-full ${STATUS_DOT[sub.status ?? ''] ?? 'bg-md-outline'}`} />
                            {statusLabel(sub.status ?? '')}
                          </span>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => handleResetToken(sub.id!)}
                              title={t('resetToken')}
                              className="state-layer inline-flex size-7 items-center justify-center rounded-md
                                text-muted-foreground hover:text-foreground
                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary
                                transition-colors"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteSub(sub.id!)}
                              className="state-layer inline-flex size-7 items-center justify-center rounded-md
                                text-md-error hover:bg-md-error-container
                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-error
                                transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
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
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="rounded-2xl border bg-popover elevation-3 animate-scale-in sm:max-w-md">
          <DialogHeader className="pb-2">
            <DialogTitle className="font-display text-lg font-600 text-foreground">
              {t('editCustomer')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground">{t('nickname')}</Label>
              <Input
                value={editNickname}
                onChange={(e) => setEditNickname(e.target.value)}
                className="rounded-lg border-border bg-md-surface-container-high focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground">{t('status')}</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger className="rounded-lg border-border bg-md-surface-container-high focus:ring-md-primary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border bg-popover elevation-2">
                  <SelectItem value="active">{t('active')}</SelectItem>
                  <SelectItem value="suspended">{t('suspended')}</SelectItem>
                  <SelectItem value="banned">{t('banned')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setEditOpen(false)}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg px-4 py-2
                text-sm font-500 border border-border bg-card text-foreground
                hover:bg-md-surface-container-high
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-colors"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleEdit}
              disabled={saving}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg px-5 py-2
                text-sm font-500 bg-md-primary text-md-on-primary elevation-1
                disabled:opacity-50 disabled:cursor-not-allowed
                hover:elevation-2
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-shadow"
            >
              {saving ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Password Dialog ── */}
      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent className="rounded-2xl border bg-popover elevation-3 animate-scale-in sm:max-w-md">
          <DialogHeader className="pb-2">
            <DialogTitle className="font-display text-lg font-600 text-foreground">
              {t('resetPassword')}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-1.5">
            <Label className="text-xs font-500 text-muted-foreground">{t('newPassword')}</Label>
            <Input
              type="password"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              className="rounded-lg border-border bg-md-surface-container-high focus-visible:ring-md-primary"
            />
          </div>
          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setPwdOpen(false)}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg px-4 py-2
                text-sm font-500 border border-border bg-card text-foreground
                hover:bg-md-surface-container-high
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-colors"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleResetPassword}
              disabled={savingPwd || !newPwd}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg px-5 py-2
                text-sm font-500 bg-md-primary text-md-on-primary elevation-1
                disabled:opacity-50 disabled:cursor-not-allowed
                hover:elevation-2
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-shadow"
            >
              {savingPwd ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create Subscription Dialog ── */}
      <Dialog open={subOpen} onOpenChange={setSubOpen}>
        <DialogContent className="rounded-2xl border bg-popover elevation-3 animate-scale-in sm:max-w-md">
          <DialogHeader className="pb-2">
            <DialogTitle className="font-display text-lg font-600 text-foreground">
              {t('createSubscription')}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-1.5">
            <Label className="text-xs font-500 text-muted-foreground">{t('selectPlan')}</Label>
            <Select value={selectedPlan} onValueChange={setSelectedPlan}>
              <SelectTrigger className="rounded-lg border-border bg-md-surface-container-high focus:ring-md-primary">
                <SelectValue placeholder={t('selectPlan')} />
              </SelectTrigger>
              <SelectContent className="rounded-xl border bg-popover elevation-2">
                {plans.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setSubOpen(false)}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg px-4 py-2
                text-sm font-500 border border-border bg-card text-foreground
                hover:bg-md-surface-container-high
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-colors"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleCreateSub}
              disabled={creatingSub || !selectedPlan}
              className="state-layer ripple inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2
                text-sm font-500 bg-md-primary text-md-on-primary elevation-1
                disabled:opacity-50 disabled:cursor-not-allowed
                hover:elevation-2
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-shadow"
            >
              {creatingSub ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
