import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { handler_RoleDetail } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import type { PermissionItem } from '@/lib/domain-types';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Save, ShieldCheck, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function RolesPage() {
  const router = useRouter();
  const t = useTranslations('roles');
  const tCommon = useTranslations('common');
  const { user: currentUser, loading: authLoading } = useCurrentUser();
  const [roles, setRoles] = useState<handler_RoleDetail[]>([]);
  const [allPerms, setAllPerms] = useState<PermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [editPerms, setEditPerms] = useState<Record<number, Set<string>>>({});
  const [saving, setSaving] = useState<number | null>(null);

  // 权限按资源分组（在组件内，使用翻译）
  const PERM_GROUPS = [
    { key: 'node', label: t('permGroup_node'), prefix: 'node:' },
    { key: 'user', label: t('permGroup_user'), prefix: 'user:' },
    { key: 'audit', label: t('permGroup_audit'), prefix: 'audit:' },
    { key: 'subscription', label: t('permGroup_subscription'), prefix: 'subscription:' },
    { key: 'label', label: t('permGroup_label'), prefix: 'label:' },
    { key: 'prometheus', label: t('permGroup_prometheus'), prefix: 'prometheus:' },
    { key: 'role', label: t('permGroup_role'), prefix: 'role:' },
  ];

  useEffect(() => {
    if (!authLoading && currentUser && !currentUser.can('role:read')) {
      router.replace('/dashboard');
    }
  }, [authLoading, currentUser, router]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [roleList, permList] = await Promise.all([
        sessionApi(AdminService.adminListRoles()),
        sessionApi(AdminService.adminListPermissions()) as Promise<PermissionItem[]>,
      ]);
      setRoles(roleList);
      setAllPerms(permList);
      const init: Record<number, Set<string>> = {};
      for (const r of roleList) {
        init[r.id!] = new Set(r.permissions ?? []);
      }
      setEditPerms(init);
    } catch (e: unknown) {
      setError(getErrorMessage(e, tCommon('loading')));
    } finally {
      setLoading(false);
    }
  }, [tCommon]);

  useEffect(() => {
    if (!authLoading && currentUser?.can('role:read')) {
      loadData();
    }
  }, [authLoading, currentUser, loadData]);

  function togglePerm(roleId: number, slug: string) {
    setEditPerms((prev) => {
      const next = new Set(prev[roleId] ?? []);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return { ...prev, [roleId]: next };
    });
  }

  async function handleSave(role: handler_RoleDetail) {
    const id = role.id!;
    setSaving(id);
    setError('');
    setSuccess('');
    try {
      await sessionApi(
        AdminService.adminSetRolePermissions({
          id,
          requestBody: { permissions: Array.from(editPerms[id] ?? []) },
        }),
      );
      setSuccess(t('permsSaved'));
      await loadData();
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('permsSaveFailed')));
    } finally {
      setSaving(null);
    }
  }

  const canWrite = currentUser?.can('role:write') ?? false;

  if (authLoading) return null;

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-md-primary-container text-md-on-primary-container">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-600 text-foreground tracking-tight">
              {t('roleManagement')}
            </h1>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="state-layer ripple inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-500 text-foreground transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          <span>{tCommon('refresh')}</span>
        </button>
      </div>

      {/* ── Status banners ── */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-md-error-container bg-md-error-container px-4 py-3 animate-slide-up">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-sm text-md-on-error-container">{error}</p>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-3 rounded-xl border border-md-tertiary-container bg-md-tertiary-container px-4 py-3 animate-slide-up">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-md-tertiary" />
          <p className="text-sm text-md-on-tertiary-container">{success}</p>
        </div>
      )}

      {/* ── Loading state ── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 animate-fade-in">
          {/* M3 circular progress — CSS-only indeterminate */}
          <span className="relative flex size-10">
            <svg
              className="animate-spin"
              style={{ animationDuration: '1.4s', animationTimingFunction: 'linear' }}
              viewBox="0 0 40 40"
              fill="none"
            >
              <circle
                cx="20" cy="20" r="16"
                stroke="hsl(var(--md-outline-variant))"
                strokeWidth="3.5"
              />
              <circle
                cx="20" cy="20" r="16"
                stroke="hsl(var(--md-primary))"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray="60 40"
              />
            </svg>
          </span>
          <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
        </div>
      ) : (

        /* ── Role cards ── */
        <div className="space-y-4">
          {roles.map((role, i) => {
            const rid = role.id!;
            const currentSet = editPerms[rid] ?? new Set<string>();
            return (
              <div
                key={rid}
                className="bg-card border rounded-xl overflow-hidden animate-slide-up"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {/* Card header row */}
                <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border bg-md-surface-container-high/40">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center size-8 rounded-lg bg-md-secondary-container text-md-on-secondary-container">
                      <KeyRound className="size-4" />
                    </div>
                    <span className="font-display text-base font-600 text-foreground">
                      {role.name}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-primary-container text-md-on-primary-container">
                      {currentSet.size}
                    </span>
                  </div>
                  {canWrite && (
                    <button
                      onClick={() => handleSave(role)}
                      disabled={saving === rid}
                      className="state-layer ripple inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-500 bg-md-primary text-md-on-primary elevation-1 transition-shadow hover:elevation-2 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
                    >
                      <Save className={`size-4 ${saving === rid ? 'animate-pulse' : ''}`} />
                      <span>{saving === rid ? tCommon('saving') : tCommon('save')}</span>
                    </button>
                  )}
                </div>

                {/* Permission groups grid */}
                <div className="px-5 py-4">
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {PERM_GROUPS.map((group) => {
                      const groupPerms = allPerms.filter((p) => p.slug.startsWith(group.prefix));
                      if (groupPerms.length === 0) return null;
                      return (
                        <div key={group.key} className="space-y-2">
                          <p className="text-xs font-500 text-muted-foreground uppercase tracking-widest">
                            {group.label}
                          </p>
                          <div className="space-y-1.5">
                            {groupPerms.map((p) => {
                              const checked = currentSet.has(p.slug);
                              return (
                                <label
                                  key={p.slug}
                                  className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 cursor-pointer hover-state transition-colors ${!canWrite ? 'cursor-default opacity-60' : ''}`}
                                >
                                  {/* Custom M3 checkbox */}
                                  <span
                                    className={`flex items-center justify-center size-4 rounded shrink-0 border-2 transition-colors ${
                                      checked
                                        ? 'bg-md-primary border-md-primary'
                                        : 'bg-transparent border-md-outline'
                                    }`}
                                  >
                                    {checked && (
                                      <svg viewBox="0 0 10 8" fill="none" className="size-2.5">
                                        <path
                                          d="M1 4l3 3 5-6"
                                          stroke="hsl(var(--md-on-primary))"
                                          strokeWidth="1.6"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
                                    )}
                                  </span>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => canWrite && togglePerm(rid, p.slug)}
                                    disabled={!canWrite}
                                    className="sr-only"
                                  />
                                  <span className="text-sm text-foreground">
                                    {p.slug.replace(group.prefix, '')}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
