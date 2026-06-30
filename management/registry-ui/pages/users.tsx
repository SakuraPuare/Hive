import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { handler_RoleDetail } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import type { AdminUser } from '@/lib/domain-types';
import { useCurrentUser } from '@/lib/auth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { RefreshCw, Plus, Trash2, KeyRound, UserCog } from 'lucide-react';
import { useTranslations } from 'next-intl';

function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
}

export default function UsersPage() {
  const router = useRouter();
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const tNodes = useTranslations('nodes');
  const tAuth = useTranslations('auth');
  const { user: currentUser, loading: authLoading } = useCurrentUser();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [allRoles, setAllRoles] = useState<handler_RoleDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [creating, setCreating] = useState(false);

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<AdminUser | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  const [rolesOpen, setRolesOpen] = useState(false);
  const [rolesTarget, setRolesTarget] = useState<AdminUser | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);

  useEffect(() => {
    if (!authLoading && currentUser && !currentUser.can('user:read')) {
      router.replace('/dashboard');
    }
  }, [authLoading, currentUser, router]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [userList, roleList] = await Promise.all([
        sessionApi(AdminService.adminListUsers()) as Promise<AdminUser[]>,
        sessionApi(AdminService.adminListRoles()),
      ]);
      setUsers(userList);
      setAllRoles(roleList);
    } catch (e: unknown) {
      setError(getErrorMessage(e, tCommon('loading')));
    } finally {
      setLoading(false);
    }
  }, [tCommon]);

  useEffect(() => {
    if (!authLoading && currentUser?.can('user:read')) {
      loadData();
    }
  }, [authLoading, currentUser, loadData]);

  async function handleCreate() {
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      await sessionApi(
        AdminService.adminCreateUser({
          requestBody: { username: newUsername, password: newPassword, role: newRole },
        }),
      );
      setSuccess(t('userCreated'));
      setCreateOpen(false);
      setNewUsername('');
      setNewPassword('');
      setNewRole('viewer');
      await loadData();
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('userCreateFailed')));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(u: AdminUser) {
    if (!window.confirm(t('userDeleteConfirm', { username: u.username }))) return;
    setError('');
    setSuccess('');
    try {
      await sessionApi(AdminService.adminDeleteUser({ id: u.id }));
      setSuccess(t('userDeleted'));
      await loadData();
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('userDeleteFailed')));
    }
  }

  function openPwd(u: AdminUser) {
    setPwdTarget(u);
    setNewPwd('');
    setPwdOpen(true);
  }

  async function handleChangePassword() {
    if (!pwdTarget) return;
    setSavingPwd(true);
    setError('');
    setSuccess('');
    try {
      await sessionApi(
        AdminService.adminChangePassword({
          id: pwdTarget.id,
          requestBody: { password: newPwd },
        }),
      );
      setSuccess(t('passwordChanged'));
      setPwdOpen(false);
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('passwordChangeFailed')));
    } finally {
      setSavingPwd(false);
    }
  }

  function openRoles(u: AdminUser) {
    setRolesTarget(u);
    setSelectedRoles([...u.roles]);
    setRolesOpen(true);
  }

  function toggleRole(name: string) {
    setSelectedRoles((prev) =>
      prev.includes(name) ? prev.filter((r) => r !== name) : [...prev, name]
    );
  }

  async function handleSaveRoles() {
    if (!rolesTarget || selectedRoles.length === 0) return;
    setSavingRoles(true);
    setError('');
    setSuccess('');
    try {
      await sessionApi(
        AdminService.adminSetUserRoles({
          id: rolesTarget.id,
          requestBody: { roles: selectedRoles },
        }),
      );
      setSuccess(t('rolesSaved'));
      setRolesOpen(false);
      await loadData();
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('rolesSaveFailed')));
    } finally {
      setSavingRoles(false);
    }
  }

  const canWrite = currentUser?.can('user:write') ?? false;
  const canDelete = currentUser?.can('user:delete') ?? false;

  if (authLoading) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-600 text-foreground tracking-tight">
            {t('userManagement')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {users.length > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-md-tertiary" />
                <span className="font-display font-600 text-foreground">{users.length}</span>
                &nbsp;{t('userManagement').toLowerCase()}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="state-layer inline-flex items-center gap-1.5 rounded-lg border border-border
              bg-card px-3 py-2 text-sm font-500 text-foreground
              disabled:opacity-50 disabled:cursor-not-allowed
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
              transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {tCommon('refresh')}
          </button>
          {canWrite && (
            <button
              onClick={() => { setCreateOpen(true); setError(''); setSuccess(''); }}
              className="state-layer ripple inline-flex items-center gap-1.5 rounded-lg
                bg-md-primary px-4 py-2 text-sm font-500 text-md-on-primary elevation-1
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-shadow hover:elevation-2"
            >
              <Plus className="h-4 w-4" />
              {t('createUser')}
            </button>
          )}
        </div>
      </div>

      {/* ── Status banners ── */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-md-error-container
          bg-md-error-container px-4 py-3 text-sm text-md-on-error-container animate-slide-up">
          <span className="size-1.5 shrink-0 rounded-full bg-md-error" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-md-tertiary-container
          bg-md-tertiary-container px-4 py-3 text-sm text-md-on-tertiary-container animate-slide-up">
          <span className="size-1.5 shrink-0 rounded-full bg-md-tertiary" />
          {success}
        </div>
      )}

      {/* ── User table card ── */}
      <Card className="rounded-xl border bg-card overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border bg-md-surface-container-high/50">
                <TableHead className="w-12 text-xs font-500 text-muted-foreground uppercase tracking-wide">
                  ID
                </TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                  {tAuth('username')}
                </TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                  {t('role')}
                </TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                  {tNodes('colRegisteredAt')}
                </TableHead>
                <TableHead className="text-right text-xs font-500 text-muted-foreground uppercase tracking-wide">
                  {tNodes('colActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      {/* M3 circular progress indicator */}
                      <svg
                        className="h-8 w-8 animate-spin"
                        viewBox="0 0 32 32"
                        fill="none"
                        aria-hidden="true"
                      >
                        <circle
                          cx="16" cy="16" r="12"
                          stroke="hsl(var(--md-outline-variant))"
                          strokeWidth="3"
                        />
                        <path
                          d="M16 4 a12 12 0 0 1 12 12"
                          stroke="hsl(var(--md-primary))"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      </svg>
                      <span className="text-sm">{tCommon('loading')}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full
                        bg-md-surface-container-high text-muted-foreground">
                        <UserCog className="h-5 w-5" />
                      </div>
                      <p className="text-sm text-muted-foreground">{tCommon('noData')}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u, i) => (
                  <TableRow
                    key={u.id}
                    className="hover-state border-b border-border/60 last:border-0 animate-slide-up"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <TableCell className="font-display text-xs font-500 text-muted-foreground tabular-nums">
                      {u.id}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                          bg-md-primary-container text-md-on-primary-container text-xs font-display font-600">
                          {u.username.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-500 text-foreground">{u.username}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <span
                            key={r}
                            className={
                              r === 'superadmin'
                                ? 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-primary-container text-md-on-primary-container'
                                : r === 'admin'
                                ? 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-secondary-container text-md-on-secondary-container'
                                : 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-500 bg-muted text-muted-foreground'
                            }
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">
                      {formatDate(u.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canWrite && (
                          <>
                            <button
                              onClick={() => openRoles(u)}
                              title={t('editRoles')}
                              className="state-layer inline-flex h-8 w-8 items-center justify-center rounded-lg
                                text-muted-foreground hover:text-foreground
                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1
                                transition-colors"
                            >
                              <UserCog className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => openPwd(u)}
                              title={t('changePassword')}
                              className="state-layer inline-flex h-8 w-8 items-center justify-center rounded-lg
                                text-muted-foreground hover:text-foreground
                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1
                                transition-colors"
                            >
                              <KeyRound className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {canDelete && (
                          <button
                            disabled={u.username === currentUser?.username}
                            onClick={() => handleDelete(u)}
                            className="state-layer inline-flex h-8 w-8 items-center justify-center rounded-lg
                              text-muted-foreground hover:text-destructive
                              disabled:opacity-30 disabled:cursor-not-allowed
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-error focus-visible:ring-offset-1
                              transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── 创建用户弹窗 ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="rounded-2xl border bg-card elevation-3 sm:max-w-md animate-scale-in">
          <DialogHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-md-primary-container">
                <Plus className="h-5 w-5 text-md-on-primary-container" />
              </div>
              <DialogTitle className="font-display text-lg font-600 text-foreground">
                {t('createUser')}
              </DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {tAuth('username')}
              </Label>
              <Input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="username"
                className="rounded-lg bg-md-surface-container-high border-border
                  focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:border-transparent"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {tAuth('password')}
              </Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="rounded-lg bg-md-surface-container-high border-border
                  focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:border-transparent"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('role')}
              </Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger className="rounded-lg bg-md-surface-container-high border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl bg-popover border elevation-2">
                  {allRoles.map((r) => (
                    <SelectItem key={r.id} value={r.name ?? ''} className="rounded-lg">
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setCreateOpen(false)}
              className="state-layer inline-flex items-center justify-center rounded-lg border border-border
                bg-card px-4 py-2 text-sm font-500 text-foreground
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-colors"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !newUsername || !newPassword}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg
                bg-md-primary px-4 py-2 text-sm font-500 text-md-on-primary elevation-1
                disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-shadow hover:elevation-2"
            >
              {creating ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 修改密码弹窗 ── */}
      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent className="rounded-2xl border bg-card elevation-3 sm:max-w-md animate-scale-in">
          <DialogHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-md-secondary-container">
                <KeyRound className="h-5 w-5 text-md-on-secondary-container" />
              </div>
              <DialogTitle className="font-display text-lg font-600 text-foreground">
                {t('changePassword')}{pwdTarget ? `：${pwdTarget.username}` : ''}
              </DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('newPassword')}
              </Label>
              <Input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="••••••••"
                className="rounded-lg bg-md-surface-container-high border-border
                  focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:border-transparent"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setPwdOpen(false)}
              className="state-layer inline-flex items-center justify-center rounded-lg border border-border
                bg-card px-4 py-2 text-sm font-500 text-foreground
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-colors"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleChangePassword}
              disabled={savingPwd || !newPwd}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg
                bg-md-primary px-4 py-2 text-sm font-500 text-md-on-primary elevation-1
                disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-shadow hover:elevation-2"
            >
              {savingPwd ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 编辑角色弹窗 ── */}
      <Dialog open={rolesOpen} onOpenChange={setRolesOpen}>
        <DialogContent className="rounded-2xl border bg-card elevation-3 sm:max-w-md animate-scale-in">
          <DialogHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-md-tertiary-container">
                <UserCog className="h-5 w-5 text-md-on-tertiary-container" />
              </div>
              <DialogTitle className="font-display text-lg font-600 text-foreground">
                {t('editRoles')}{rolesTarget ? `：${rolesTarget.username}` : ''}
              </DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            {allRoles.map((r) => {
              const checked = selectedRoles.includes(r.name ?? '');
              return (
                <label
                  key={r.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5
                    transition-colors
                    ${checked
                      ? 'bg-md-primary-container/60 text-md-on-primary-container'
                      : 'hover:bg-md-surface-container-high'
                    }`}
                >
                  <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded
                    border transition-colors
                    ${checked
                      ? 'border-md-primary bg-md-primary'
                      : 'border-border bg-transparent'
                    }`}
                  >
                    {checked && (
                      <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 fill-md-on-primary" aria-hidden="true">
                        <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRole(r.name ?? '')}
                    className="sr-only"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-500">{r.name}</span>
                    {r.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setRolesOpen(false)}
              className="state-layer inline-flex items-center justify-center rounded-lg border border-border
                bg-card px-4 py-2 text-sm font-500 text-foreground
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-colors"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleSaveRoles}
              disabled={savingRoles || selectedRoles.length === 0}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg
                bg-md-primary px-4 py-2 text-sm font-500 text-md-on-primary elevation-1
                disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2
                transition-shadow hover:elevation-2"
            >
              {savingRoles ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
