import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { handler_RoleDetail } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import type { AdminUser } from '@/lib/domain-types';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('userManagement')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className="mr-1 h-4 w-4" />
            {tCommon('refresh')}
          </Button>
          {canWrite && (
            <Button size="sm" onClick={() => { setCreateOpen(true); setError(''); setSuccess(''); }}>
              <Plus className="mr-1 h-4 w-4" />
              {t('createUser')}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-600 dark:text-green-400">{success}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">ID</TableHead>
                <TableHead>{tAuth('username')}</TableHead>
                <TableHead>{t('role')}</TableHead>
                <TableHead>{tNodes('colRegisteredAt')}</TableHead>
                <TableHead className="text-right">{tNodes('colActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {tCommon('loading')}
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {tCommon('noData')}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="text-muted-foreground">{u.id}</TableCell>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <Badge key={r} variant={r === 'superadmin' ? 'default' : r === 'admin' ? 'secondary' : 'outline'}>
                            {r}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canWrite && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => openRoles(u)} title={t('editRoles')}>
                              <UserCog className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openPwd(u)} title={t('changePassword')}>
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={u.username === currentUser?.username}
                            onClick={() => handleDelete(u)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
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

      {/* 创建用户弹窗 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createUser')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>{tAuth('username')}</Label>
              <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="username" />
            </div>
            <div className="space-y-1">
              <Label>{tAuth('password')}</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <div className="space-y-1">
              <Label>{t('role')}</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allRoles.map((r) => (
                    <SelectItem key={r.id} value={r.name ?? ''}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{tCommon('cancel')}</Button>
            <Button onClick={handleCreate} disabled={creating || !newUsername || !newPassword}>
              {creating ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 修改密码弹窗 */}
      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('changePassword')}{pwdTarget ? `：${pwdTarget.username}` : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>{t('newPassword')}</Label>
              <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="••••••••" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwdOpen(false)}>{tCommon('cancel')}</Button>
            <Button onClick={handleChangePassword} disabled={savingPwd || !newPwd}>
              {savingPwd ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑角色弹窗 */}
      <Dialog open={rolesOpen} onOpenChange={setRolesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editRoles')}{rolesTarget ? `：${rolesTarget.username}` : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {allRoles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(r.name ?? '')}
                  onChange={() => toggleRole(r.name ?? '')}
                  className="h-4 w-4"
                />
                <span className="text-sm font-medium">{r.name}</span>
                {r.description && <span className="text-xs text-muted-foreground">{r.description}</span>}
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRolesOpen(false)}>{tCommon('cancel')}</Button>
            <Button onClick={handleSaveRoles} disabled={savingRoles || selectedRoles.length === 0}>
              {savingRoles ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
