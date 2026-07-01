import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
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
import { useToast } from '@/components/ui/toast';
import { RefreshCw, Save, ShieldCheck, AlertCircle, KeyRound, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Permissions whose removal can lock the editing user out of this page. */
const CRITICAL_PERMS = ['role:write', 'role:read'];

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export default function RolesPage() {
  const router = useRouter();
  const t = useTranslations('roles');
  const tCommon = useTranslations('common');
  const toast = useToast();
  const { user: currentUser, loading: authLoading } = useCurrentUser();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [roles, setRoles] = useState<handler_RoleDetail[]>([]);
  const [allPerms, setAllPerms] = useState<PermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);

  const [editPerms, setEditPerms] = useState<Record<number, Set<string>>>({});
  const [saving, setSaving] = useState<number | null>(null);
  // Role pending a lockout confirmation (set when a save would drop the user's
  // own critical permission), plus the list of critical perms being removed.
  const [confirm, setConfirm] = useState<{ role: handler_RoleDetail; removed: string[] } | null>(null);

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
      setDenied(true);
      const id = setTimeout(() => router.replace('/dashboard'), 1200);
      return () => clearTimeout(id);
    }
  }, [authLoading, currentUser, router]);

  // Move focus to the access-denied heading so SR users are not stranded.
  useEffect(() => {
    if (denied) headingRef.current?.focus();
  }, [denied]);

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

  // Saved permission set per role (server state), used for dirty diffing.
  const savedSets = useMemo(() => {
    const map: Record<number, Set<string>> = {};
    for (const r of roles) map[r.id!] = new Set(r.permissions ?? []);
    return map;
  }, [roles]);

  function togglePerm(roleId: number, slug: string) {
    setEditPerms((prev) => {
      const next = new Set(prev[roleId] ?? []);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return { ...prev, [roleId]: next };
    });
  }

  /** Persist a role's permissions and refresh only that role's baseline. */
  const doSave = useCallback(
    async (role: handler_RoleDetail) => {
      const id = role.id!;
      const perms = Array.from(editPerms[id] ?? []);
      setSaving(id);
      setError('');
      try {
        await sessionApi(
          AdminService.adminSetRolePermissions({ id, requestBody: { permissions: perms } }),
        );
        // Refresh only this role's saved baseline so concurrent edits on other
        // cards are not clobbered by a full reload.
        setRoles((prev) =>
          prev.map((r) => (r.id === id ? { ...r, permissions: perms } : r)),
        );
        toast.success(t('permsSaved'));
      } catch (e: unknown) {
        toast.error(getErrorMessage(e, t('permsSaveFailed')));
      } finally {
        setSaving(null);
      }
    },
    [editPerms, t, toast],
  );

  function handleSaveClick(role: handler_RoleDetail) {
    const id = role.id!;
    const saved = savedSets[id] ?? new Set<string>();
    const next = editPerms[id] ?? new Set<string>();
    // Lockout guard: warn before removing a critical perm the current user relies on.
    const removed = CRITICAL_PERMS.filter(
      (p) => saved.has(p) && !next.has(p) && (currentUser?.can(p) ?? false),
    );
    if (removed.length > 0) {
      setConfirm({ role, removed });
      return;
    }
    void doSave(role);
  }

  const canWrite = currentUser?.can('role:write') ?? false;

  if (authLoading) return null;

  if (denied) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center animate-fade-in">
        <div className="flex items-center justify-center size-12 rounded-full bg-md-error-container text-md-on-error-container">
          <ShieldCheck className="size-6" aria-hidden="true" />
        </div>
        <h1
          ref={headingRef}
          tabIndex={-1}
          role="alert"
          className="font-display text-xl font-600 text-foreground outline-none"
        >
          {t('accessDenied')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('redirecting')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-md-primary-container text-md-on-primary-container">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-600 text-foreground tracking-tight">
              {t('roleManagement')}
            </h1>
          </div>
        </div>
        <Button variant="outline" onClick={loadData} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          <span>{tCommon('refresh')}</span>
        </Button>
      </div>

      {/* ── Error banner (assertive live region + dismiss) ── */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-3 rounded-xl border border-md-error-container bg-md-error-container px-4 py-3 animate-slide-up"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <p className="flex-1 text-sm text-md-on-error-container">{error}</p>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setError('')}
            aria-label={tCommon('dismiss')}
            className="-my-1 -mr-1 shrink-0 text-md-on-error-container"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      )}

      {/* ── Loading state ── */}
      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col items-center justify-center gap-4 py-20 animate-fade-in"
        >
          {/* M3 circular progress — CSS-only indeterminate */}
          <span className="relative flex size-10">
            <svg
              className="animate-spin"
              style={{ animationDuration: '1.4s', animationTimingFunction: 'linear' }}
              viewBox="0 0 40 40"
              fill="none"
              aria-hidden="true"
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
      ) : roles.length === 0 ? (

        /* ── Empty state ── */
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center animate-fade-in">
          <div className="flex items-center justify-center size-12 rounded-full bg-md-surface-container-high text-muted-foreground">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </div>
          <h2 className="font-display text-lg font-600 text-foreground">{t('emptyTitle')}</h2>
          <p className="max-w-sm text-sm text-muted-foreground">{t('emptyDescription')}</p>
        </div>
      ) : (

        /* ── Role cards ── */
        <div className="space-y-4">
          {roles.map((role, i) => {
            const rid = role.id!;
            const currentSet = editPerms[rid] ?? new Set<string>();
            const savedSet = savedSets[rid] ?? new Set<string>();
            const dirty = !setsEqual(currentSet, savedSet);
            return (
              <Card
                key={rid}
                className="gap-0 overflow-hidden py-0 animate-slide-up"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {/* Card header row */}
                <CardHeader className="flex flex-row items-center justify-between gap-4 px-5 py-4 border-b border-border bg-md-surface-container-high/40">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center size-8 rounded-lg bg-md-secondary-container text-md-on-secondary-container">
                      <KeyRound className="size-4" aria-hidden="true" />
                    </div>
                    <span className="font-display text-base font-600 text-foreground">
                      {role.name}
                    </span>
                    <Badge variant={dirty ? 'warning' : 'default'}>
                      {dirty ? (
                        <>
                          {savedSet.size}
                          <span aria-hidden="true"> → </span>
                          {currentSet.size}
                        </>
                      ) : (
                        currentSet.size
                      )}
                      <span className="sr-only"> {t('permissions')}</span>
                    </Badge>
                    {dirty && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-500 text-md-on-surface-variant">
                        <span
                          className="size-1.5 rounded-full bg-[hsl(43_96%_50%)]"
                          aria-hidden="true"
                        />
                        {t('unsavedChanges')}
                      </span>
                    )}
                  </div>
                  {canWrite && (
                    <Button
                      onClick={() => handleSaveClick(role)}
                      disabled={!dirty}
                      loading={saving === rid}
                    >
                      <Save aria-hidden="true" />
                      <span>{saving === rid ? tCommon('saving') : tCommon('save')}</span>
                    </Button>
                  )}
                </CardHeader>

                {/* Permission groups grid */}
                <CardContent className="px-5 py-4">
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {PERM_GROUPS.map((group) => {
                      // Distinguish "nothing loaded" (drop entirely) from
                      // "group legitimately empty" (show a muted note).
                      if (allPerms.length === 0) return null;
                      const groupPerms = allPerms.filter((p) => p.slug.startsWith(group.prefix));
                      return (
                        <div key={group.key} className="space-y-2">
                          <p className="text-xs font-500 text-muted-foreground uppercase tracking-widest">
                            {group.label}
                          </p>
                          {groupPerms.length === 0 ? (
                            <p className="px-2 py-1.5 text-sm text-muted-foreground italic">
                              {t('noPermsInGroup')}
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {groupPerms.map((p) => {
                                const checked = currentSet.has(p.slug);
                                const label = p.slug.replace(group.prefix, '');
                                return (
                                  <label
                                    key={p.slug}
                                    className={`flex min-h-12 items-center gap-3 rounded-lg px-2 hover-state transition-colors ${
                                      canWrite ? 'cursor-pointer' : 'cursor-default opacity-60'
                                    }`}
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={() => canWrite && togglePerm(rid, p.slug)}
                                      disabled={!canWrite}
                                      aria-label={`${role.name} · ${p.slug}`}
                                    />
                                    <span className="text-sm text-foreground">{label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
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

      {/* ── Lockout confirmation (destructive guard) ── */}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && saving === null) setConfirm(null);
        }}
      >
        <AlertDialogContent pending={saving !== null}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('lockoutTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('lockoutWarning', { perms: confirm?.removed.join('、') ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving !== null}>
              {tCommon('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={saving !== null}
              loadingLabel={tCommon('saving')}
              onClick={(e) => {
                e.preventDefault();
                if (!confirm) return;
                const role = confirm.role;
                void doSave(role).then(() => setConfirm(null));
              }}
            >
              {t('confirmSave')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
