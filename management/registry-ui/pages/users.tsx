import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { handler_RoleDetail } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import type { AdminUser } from '@/lib/domain-types';
import { useCurrentUser } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/toast';
import { Card, CardContent } from '@/components/ui/card';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
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
import { RefreshCw, Plus, Trash2, KeyRound, UserCog, Search, Users, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Shared password validation rule: ≥8 chars, contains a letter, contains a digit. */
function validatePassword(pwd: string): boolean {
  return pwd.length >= 8 && /[a-zA-Z]/.test(pwd) && /\d/.test(pwd);
}

/** Unicode-safe first character for avatar display. */
function firstChar(s: string): string {
  return ([...s][0]?.toUpperCase()) ?? '?';
}

export default function UsersPage() {
  const router = useRouter();
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const tNodes = useTranslations('nodes');
  const tAuth = useTranslations('auth');
  const toast = useToast();
  const fmt = useFormat();
  const { user: currentUser, loading: authLoading } = useCurrentUser();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [allRoles, setAllRoles] = useState<handler_RoleDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Search / filter (synced to URL query so refresh keeps state).
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [creating, setCreating] = useState(false);
  const [touchedUsername, setTouchedUsername] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<AdminUser | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [touchedNewPwd, setTouchedNewPwd] = useState(false);

  const [rolesOpen, setRolesOpen] = useState(false);
  const [rolesTarget, setRolesTarget] = useState<AdminUser | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Client-side validation helpers ──
  const usernameError =
    touchedUsername && newUsername.trim().length === 0 ? t('usernameRequired') : '';
  const passwordRuleOk = validatePassword(newPassword);
  const passwordError =
    touchedPassword && newPassword.length > 0 && !passwordRuleOk ? t('passwordRule') : '';
  const newPwdRuleOk = validatePassword(newPwd);
  const newPwdError =
    touchedNewPwd && newPwd.length > 0 && !newPwdRuleOk ? t('passwordRule') : '';

  useEffect(() => {
    if (!authLoading && currentUser && !currentUser.can('user:read')) {
      router.replace('/dashboard');
    }
  }, [authLoading, currentUser, router]);

  // Hydrate search/filter from URL query once the router is ready.
  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query.q;
    const role = router.query.role;
    if (typeof q === 'string') setSearch(q);
    if (typeof role === 'string') setRoleFilter(role);
  }, [router.isReady, router.query.q, router.query.role]);

  const syncQuery = useCallback(
    (next: { q?: string; role?: string }) => {
      const query: Record<string, string> = {};
      const q = next.q ?? search;
      const role = next.role ?? roleFilter;
      if (q.trim()) query.q = q.trim();
      if (role && role !== 'all') query.role = role;
      router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
    },
    [router, search, roleFilter],
  );

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
    try {
      await sessionApi(
        AdminService.adminCreateUser({
          requestBody: { username: newUsername, password: newPassword, role: newRole },
        }),
      );
      toast.success(t('userCreated'));
      setCreateOpen(false);
      await loadData();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, t('userCreateFailed')));
    } finally {
      setCreating(false);
    }
  }

  // Reset the create form whenever the dialog fully closes.
  function handleCreateOpenChange(open: boolean) {
    setCreateOpen(open);
    if (!open) {
      setNewUsername('');
      setNewPassword('');
      setNewRole('viewer');
      setTouchedUsername(false);
      setTouchedPassword(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await sessionApi(AdminService.adminDeleteUser({ id: deleteTarget.id }));
      toast.success(t('userDeleted'));
      setDeleteTarget(null);
      await loadData();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, t('userDeleteFailed')));
    } finally {
      setDeleting(false);
    }
  }

  function openPwd(u: AdminUser) {
    setPwdTarget(u);
    setNewPwd('');
    setTouchedNewPwd(false);
    setSavingPwd(false);
    setPwdOpen(true);
  }

  async function handleChangePassword() {
    if (!pwdTarget) return;
    setSavingPwd(true);
    try {
      await sessionApi(
        AdminService.adminChangePassword({
          id: pwdTarget.id,
          requestBody: { password: newPwd },
        }),
      );
      toast.success(t('passwordChanged'));
      setPwdOpen(false);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, t('passwordChangeFailed')));
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

  function selectAllRoles() {
    setSelectedRoles(allRoles.map((r) => r.name ?? '').filter(Boolean));
  }

  function clearAllRoles() {
    setSelectedRoles([]);
  }

  async function handleSaveRoles() {
    if (!rolesTarget) return;
    if (selectedRoles.length === 0) {
      toast.error(t('rolesAtLeastOne'));
      return;
    }
    setSavingRoles(true);
    try {
      await sessionApi(
        AdminService.adminSetUserRoles({
          id: rolesTarget.id,
          requestBody: { roles: selectedRoles },
        }),
      );
      toast.success(t('rolesSaved'));
      setRolesOpen(false);
      await loadData();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, t('rolesSaveFailed')));
    } finally {
      setSavingRoles(false);
    }
  }

  const canWrite = currentUser?.can('user:write') ?? false;
  const canDelete = currentUser?.can('user:delete') ?? false;

  // Derived filtered list.
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const matchesSearch = q === '' || u.username.toLowerCase().includes(q);
      const matchesRole = roleFilter === 'all' || u.roles.includes(roleFilter);
      return matchesSearch && matchesRole;
    });
  }, [users, search, roleFilter]);

  const isFiltered = search.trim() !== '' || roleFilter !== 'all';

  function clearFilters() {
    setSearch('');
    setRoleFilter('all');
    syncQuery({ q: '', role: 'all' });
  }

  if (authLoading) return null;

  return (
    <PageContainer>
      {/* ── Page header ── */}
      <PageHeader
        icon={<Users />}
        title={t('userManagement')}
        description={
          users.length > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-md-tertiary" aria-hidden="true" />
              <span className="font-display font-600 text-foreground">{users.length}</span>
              &nbsp;{t('usersUnit')}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button
              variant="ghost"
              onClick={loadData}
              loading={loading}
            >
              {!loading && <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              {tCommon('refresh')}
            </Button>
            {canWrite && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t('createUser')}
              </Button>
            )}
          </>
        }
      />

      {/* ── Toolbar: search + role filter ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          size="sm"
          type="search"
          value={search}
          onValueChange={(v) => { setSearch(v); syncQuery({ q: v }); }}
          debounceMs={300}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          startIcon={<Search className="h-4 w-4" aria-hidden="true" />}
          clearable
          clearLabel={tCommon('clear')}
          className="max-w-xs"
        />
        <Select
          value={roleFilter}
          onValueChange={(v) => { setRoleFilter(v); syncQuery({ role: v }); }}
        >
          <SelectTrigger size="sm" className="w-44" aria-label={t('filterByRole')}>
            <SelectValue placeholder={t('filterByRole')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tCommon('all')}</SelectItem>
            {allRoles.map((r) => (
              <SelectItem key={r.id} value={r.name ?? ''}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isFiltered && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4" aria-hidden="true" />
            {tCommon('reset')}
          </Button>
        )}
      </div>

      {/* ── Status banner (load error only; CRUD feedback goes through toasts) ── */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center gap-2 rounded-xl border border-md-error-container
            bg-md-error-container px-4 py-3 text-sm text-md-on-error-container animate-slide-up"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-md-error" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* ── User table card ── */}
      <Card className="rounded-xl border bg-card overflow-hidden">
        <CardContent className="p-0">
          <Table aria-label={t('userManagement')}>
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
                    <div
                      className="flex flex-col items-center gap-3 text-muted-foreground"
                      role="status"
                      aria-live="polite"
                    >
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
              ) : filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full
                        bg-md-surface-container-high text-muted-foreground">
                        <UserCog className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {isFiltered ? tCommon('noResults') : tCommon('noData')}
                      </p>
                      {isFiltered ? (
                        <Button variant="outline" size="sm" onClick={clearFilters}>
                          {tCommon('reset')}
                        </Button>
                      ) : canWrite ? (
                        <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          {t('createUser')}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((u, i) => (
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
                          bg-md-primary-container text-md-on-primary-container text-xs font-display font-600"
                          aria-hidden="true">
                          {firstChar(u.username)}
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
                    <TableCell
                      className="text-sm text-muted-foreground tabular-nums"
                      title={fmt.dateTime(u.created_at)}
                    >
                      {fmt.relative(u.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canWrite && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-lg"
                              onClick={() => openRoles(u)}
                              title={t('editRoles')}
                              aria-label={`${t('editRoles')}: ${u.username}`}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <UserCog className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-lg"
                              onClick={() => openPwd(u)}
                              title={t('changePassword')}
                              aria-label={`${t('changePassword')}: ${u.username}`}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <KeyRound className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon-lg"
                            disabled={u.username === currentUser?.username}
                            onClick={() => setDeleteTarget(u)}
                            title={t('deleteUser')}
                            aria-label={`${t('deleteUser')}: ${u.username}`}
                            className="text-muted-foreground hover:text-destructive
                              focus-visible:ring-md-error"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
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

      {/* ── 删除用户确认 ── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}
      >
        <AlertDialogContent pending={deleting}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteUser')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('userDeleteConfirmDetail', { username: deleteTarget?.username ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={deleting}
              loadingLabel={tCommon('loading')}
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── 创建用户弹窗 ── */}
      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="rounded-2xl border bg-card elevation-3 sm:max-w-md animate-scale-in">
          <DialogHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-md-primary-container">
                <Plus className="h-5 w-5 text-md-on-primary-container" aria-hidden="true" />
              </div>
              <DialogTitle className="font-display text-lg font-600 text-foreground">
                {t('createUser')}
              </DialogTitle>
            </div>
            <DialogDescription className="sr-only">{t('createUserDesc')}</DialogDescription>
          </DialogHeader>
          <form
            id="create-user-form"
            onSubmit={(e) => { e.preventDefault(); if (newUsername && newPassword && passwordRuleOk) handleCreate(); }}
            className="space-y-4 py-2"
          >
            <div className="space-y-1.5">
              <Label
                htmlFor="new-username"
                className="text-xs font-500 text-muted-foreground uppercase tracking-wide"
              >
                {tAuth('username')}
              </Label>
              <Input
                id="new-username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                onBlur={() => setTouchedUsername(true)}
                placeholder="username"
                autoComplete="username"
                autoFocus
                error={usernameError || undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="new-password"
                className="text-xs font-500 text-muted-foreground uppercase tracking-wide"
              >
                {tAuth('password')}
              </Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onBlur={() => setTouchedPassword(true)}
                placeholder="••••••••"
                autoComplete="new-password"
                passwordToggleLabel={t('togglePassword')}
                error={passwordError || undefined}
                helperText={passwordError ? undefined : t('passwordRule')}
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="new-role"
                className="text-xs font-500 text-muted-foreground uppercase tracking-wide"
              >
                {t('role')}
              </Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger id="new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allRoles.map((r) => (
                    <SelectItem key={r.id} value={r.name ?? ''}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Submit handled by form onSubmit; hidden submit enables Enter. */}
            <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
          </form>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => handleCreateOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              form="create-user-form"
              loading={creating}
              disabled={!newUsername || !newPassword || !passwordRuleOk}
            >
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 修改密码弹窗 ── */}
      <Dialog
        open={pwdOpen}
        onOpenChange={(open) => {
          if (!open && !savingPwd) {
            setPwdOpen(false);
            setNewPwd('');
            setTouchedNewPwd(false);
            setSavingPwd(false);
          }
        }}
      >
        <DialogContent className="rounded-2xl border bg-card elevation-3 sm:max-w-md animate-scale-in">
          <DialogHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-md-secondary-container">
                <KeyRound className="h-5 w-5 text-md-on-secondary-container" aria-hidden="true" />
              </div>
              <DialogTitle className="font-display text-lg font-600 text-foreground">
                {t('changePassword')}{pwdTarget ? `：${pwdTarget.username}` : ''}
              </DialogTitle>
            </div>
            <DialogDescription>
              {t('passwordChangeWarning', { username: pwdTarget?.username ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <form
            id="change-pwd-form"
            onSubmit={(e) => { e.preventDefault(); if (newPwd && newPwdRuleOk) handleChangePassword(); }}
            className="space-y-4 py-2"
          >
            <div className="space-y-1.5">
              <Label
                htmlFor="changepwd-password"
                className="text-xs font-500 text-muted-foreground uppercase tracking-wide"
              >
                {t('newPassword')}
              </Label>
              <Input
                id="changepwd-password"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                onBlur={() => setTouchedNewPwd(true)}
                placeholder="••••••••"
                autoComplete="new-password"
                autoFocus
                passwordToggleLabel={t('togglePassword')}
                error={newPwdError || undefined}
                helperText={newPwdError ? undefined : t('passwordRule')}
              />
            </div>
            <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
          </form>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setPwdOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="submit"
              form="change-pwd-form"
              loading={savingPwd}
              disabled={!newPwd || !newPwdRuleOk}
            >
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 编辑角色弹窗 ── */}
      <Dialog open={rolesOpen} onOpenChange={(open) => { if (!open && !savingRoles) setRolesOpen(false); }}>
        <DialogContent className="rounded-2xl border bg-card elevation-3 sm:max-w-md animate-scale-in">
          <DialogHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-md-tertiary-container">
                <UserCog className="h-5 w-5 text-md-on-tertiary-container" aria-hidden="true" />
              </div>
              <DialogTitle className="font-display text-lg font-600 text-foreground">
                {t('editRoles')}{rolesTarget ? `：${rolesTarget.username}` : ''}
              </DialogTitle>
            </div>
            <DialogDescription className="sr-only">{t('editRolesDesc')}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between px-1 pt-1">
            <span className="text-xs text-muted-foreground">
              {t('rolesSelectedCount', { count: selectedRoles.length })}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={selectAllRoles}>
                {t('selectAll')}
              </Button>
              <Button variant="ghost" size="sm" onClick={clearAllRoles}>
                {tCommon('clear')}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5 py-2">
            {allRoles.map((r) => {
              const name = r.name ?? '';
              const checked = selectedRoles.includes(name);
              const descId = r.description ? `role-desc-${r.id}` : undefined;
              return (
                <label
                  key={r.id}
                  htmlFor={`role-${r.id}`}
                  className={[
                    'state-layer flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5',
                    'transition-colors',
                    checked
                      ? 'bg-md-primary-container/60 text-md-on-primary-container ring-1 ring-md-primary/40'
                      : 'hover:bg-md-surface-container-high',
                  ].join(' ')}
                >
                  <Checkbox
                    id={`role-${r.id}`}
                    className="mt-0.5"
                    checked={checked}
                    onCheckedChange={() => toggleRole(name)}
                    aria-describedby={descId}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-500">{r.name}</span>
                    {r.description && (
                      <p id={descId} className="mt-0.5 text-xs text-muted-foreground">
                        {r.description}
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setRolesOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              onClick={handleSaveRoles}
              loading={savingRoles}
              disabled={selectedRoles.length === 0}
            >
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
