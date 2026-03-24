import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { listRoles, listPermissions, setRolePermissions, type Role, type PermissionItem } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Save } from 'lucide-react';
import { t } from '@/lib/i18n';

// 权限按资源分组
const PERM_GROUPS: { key: string; label: string; prefix: string }[] = [
  { key: 'node', label: t.permGroup_node, prefix: 'node:' },
  { key: 'user', label: t.permGroup_user, prefix: 'user:' },
  { key: 'audit', label: t.permGroup_audit, prefix: 'audit:' },
  { key: 'subscription', label: t.permGroup_subscription, prefix: 'subscription:' },
  { key: 'label', label: t.permGroup_label, prefix: 'label:' },
  { key: 'prometheus', label: t.permGroup_prometheus, prefix: 'prometheus:' },
  { key: 'role', label: t.permGroup_role, prefix: 'role:' },
];

export default function RolesPage() {
  const router = useRouter();
  const { user: currentUser, loading: authLoading } = useCurrentUser();
  const [roles, setRoles] = useState<Role[]>([]);
  const [allPerms, setAllPerms] = useState<PermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 每个角色的编辑状态：roleId → Set<slug>
  const [editPerms, setEditPerms] = useState<Record<number, Set<string>>>({});
  const [saving, setSaving] = useState<number | null>(null);

  // 权限保护
  useEffect(() => {
    if (!authLoading && currentUser && !currentUser.can('role:read')) {
      router.replace('/dashboard');
    }
  }, [authLoading, currentUser, router]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [roleList, permList] = await Promise.all([listRoles(), listPermissions()]);
      setRoles(roleList);
      setAllPerms(permList);
      // 初始化编辑状态
      const init: Record<number, Set<string>> = {};
      for (const r of roleList) {
        init[r.id] = new Set(r.permissions);
      }
      setEditPerms(init);
    } catch (e: any) {
      setError(e?.error || e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && currentUser?.can('role:read')) {
      loadData();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, currentUser]);

  function togglePerm(roleId: number, slug: string) {
    setEditPerms((prev) => {
      const next = new Set(prev[roleId] ?? []);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return { ...prev, [roleId]: next };
    });
  }

  async function handleSave(role: Role) {
    setSaving(role.id);
    setError('');
    setSuccess('');
    try {
      await setRolePermissions(role.id, Array.from(editPerms[role.id] ?? []));
      setSuccess(t.permsSaved);
      await loadData();
    } catch (e: any) {
      setError(e?.error || e?.message || t.permsSaveFailed);
    } finally {
      setSaving(null);
    }
  }

  const canWrite = currentUser?.can('role:write') ?? false;

  if (authLoading) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t.roleManagement}</h1>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className="mr-1 h-4 w-4" />
          {t.refresh}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-600 dark:text-green-400">{success}</p>}

      {loading ? (
        <p className="text-muted-foreground">{t.loading}</p>
      ) : (
        <div className="space-y-4">
          {roles.map((role) => {
            const currentSet = editPerms[role.id] ?? new Set<string>();
            return (
              <Card key={role.id}>
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{role.name}</span>
                      <Badge variant="outline">{currentSet.size} 个权限</Badge>
                    </div>
                    {canWrite && (
                      <Button
                        size="sm"
                        onClick={() => handleSave(role)}
                        disabled={saving === role.id}
                      >
                        <Save className="mr-1 h-4 w-4" />
                        {saving === role.id ? t.saving : t.save}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {PERM_GROUPS.map((group) => {
                      const groupPerms = allPerms.filter((p) => p.slug.startsWith(group.prefix));
                      if (groupPerms.length === 0) return null;
                      return (
                        <div key={group.key} className="space-y-1">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            {group.label}
                          </p>
                          {groupPerms.map((p) => (
                            <label key={p.slug} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={currentSet.has(p.slug)}
                                onChange={() => canWrite && togglePerm(role.id, p.slug)}
                                disabled={!canWrite}
                                className="h-4 w-4"
                              />
                              <span className="text-sm">{p.slug.replace(group.prefix, '')}</span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
