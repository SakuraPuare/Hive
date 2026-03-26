import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Customer, model_CustomerSubscription, model_Plan } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
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

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  suspended: 'bg-yellow-100 text-yellow-800',
  banned: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-800',
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
    } catch (e: any) {
      setError(e?.message || t('loadFailed'));
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
    setEditStatus(customer.status);
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
    } catch (e: any) {
      setError(e?.message || 'Update failed');
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
    } catch (e: any) {
      setError(e?.message || 'Reset failed');
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
    } catch (e: any) {
      setError(e?.message || 'Create failed');
    } finally {
      setCreatingSub(false);
    }
  }

  async function handleResetToken(subId: number) {
    try {
      await sessionApi(AdminService.adminResetSubscriptionToken({ id: subId }));
      loadCustomer();
    } catch (e: any) {
      setError(e?.message || 'Reset token failed');
    }
  }

  async function handleDeleteSub(subId: number) {
    try {
      await sessionApi(AdminService.adminDeleteSubscription({ id: subId }));
      loadCustomer();
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    }
  }

  function copyToken(sub: Subscription) {
    navigator.clipboard.writeText(sub.token ?? '');
    setCopiedId(sub.id ?? null);
    setTimeout(() => setCopiedId(null), 1500);
  }

  const statusLabel = (s: string) =>
    ({ active: t('active'), suspended: t('suspended'), banned: t('banned'), expired: t('expired') }[s] ?? s);

  if (authLoading || loading) return null;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/customers')}>
        <ArrowLeft className="mr-1 h-4 w-4" />{tCommon('back')}
      </Button>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {customer && (
        <>
          {/* Customer Info Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">{t('customerInfo')}</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setNewPwd(''); setPwdOpen(true); }}>
                  <KeyRound className="mr-1 h-3.5 w-3.5" />{t('resetPassword')}
                </Button>
                <Button variant="outline" size="sm" onClick={openEdit}>
                  {tCommon('edit')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground">{t('email')}</span>
                  <p>{customer.email}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">{t('nickname')}</span>
                  <p>{customer.nickname || '—'}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">{t('status')}</span>
                  <p><Badge className={STATUS_COLORS[customer.status]}>{statusLabel(customer.status)}</Badge></p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">{t('colCreatedAt')}</span>
                  <p>{formatDate(customer.created_at)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Subscriptions */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">{t('subscriptions')}</CardTitle>
              <Button size="sm" onClick={() => setSubOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />{t('createSubscription')}
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('planName')}</TableHead>
                    <TableHead>{t('token')}</TableHead>
                    <TableHead>{t('trafficUsed')}</TableHead>
                    <TableHead>{t('expiresAt')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead className="text-right">{t('colActions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscriptions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">
                        {t('noSubscriptions')}
                      </TableCell>
                    </TableRow>
                  )}
                  {subscriptions.map((sub) => {
                    const pct = sub.traffic_limit > 0 ? Math.min(100, (sub.traffic_used / sub.traffic_limit) * 100) : 0;
                    return (
                      <TableRow key={sub.id}>
                        <TableCell>{sub.plan_name}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <code className="text-xs max-w-[120px] truncate">{sub.token}</code>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToken(sub)}>
                              <Copy className="h-3 w-3" />
                            </Button>
                            {copiedId === sub.id && <span className="text-xs text-green-600">{t('copied')}</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatBytes(sub.traffic_used)} / {formatBytes(sub.traffic_limit)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{formatDate(sub.expires_at)}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLORS[sub.status]}>{statusLabel(sub.status)}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleResetToken(sub.id)} title={t('resetToken')}>
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDeleteSub(sub.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
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

      {/* Edit Customer Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editCustomer')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>{t('nickname')}</Label>
              <Input value={editNickname} onChange={(e) => setEditNickname(e.target.value)} />
            </div>
            <div>
              <Label>{t('status')}</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('active')}</SelectItem>
                  <SelectItem value="suspended">{t('suspended')}</SelectItem>
                  <SelectItem value="banned">{t('banned')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{tCommon('cancel')}</Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('resetPassword')}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label>{t('newPassword')}</Label>
            <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdOpen(false)}>{tCommon('cancel')}</Button>
            <Button onClick={handleResetPassword} disabled={savingPwd || !newPwd}>
              {savingPwd ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Subscription Dialog */}
      <Dialog open={subOpen} onOpenChange={setSubOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createSubscription')}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label>{t('selectPlan')}</Label>
            <Select value={selectedPlan} onValueChange={setSelectedPlan}>
              <SelectTrigger><SelectValue placeholder={t('selectPlan')} /></SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubOpen(false)}>{tCommon('cancel')}</Button>
            <Button onClick={handleCreateSub} disabled={creatingSub || !selectedPlan}>
              {creatingSub ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
