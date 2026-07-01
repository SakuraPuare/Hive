import React, { useCallback, useDeferredValue, useEffect, useId, useState } from 'react';
import {
  AdminService,
  SubscriptionService,
} from '@/src/generated/client';
import type { model_Node, model_SubscriptionGroup } from '@/src/generated/client';
import { apiPath, apiUrl, sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useClipboard } from '@/lib/use-clipboard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/toast';
import { BookOpen, Download, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslations } from 'next-intl';
import { useCurrentUser } from '@/lib/auth';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';

export default function Subscriptions() {
  const t = useTranslations('subscriptions');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const tNodes = useTranslations('nodes');
  const { user } = useCurrentUser();
  const canWrite = user?.can('subscription:write') ?? false;
  const toast = useToast();
  const createNameId = useId();
  const createErrorId = useId();
  const editSearchId = useId();

  const [preview, setPreview] = useState('');
  const [previewType, setPreviewType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function previewClash() {
    setLoading(true);
    setError('');
    try {
      const txt = await sessionApi(SubscriptionService.subscriptionClash());
      setPreview(txt);
      setPreviewType('Clash YAML');
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('previewFailed', { type: 'Clash YAML' })));
    } finally {
      setLoading(false);
    }
  }

  async function previewVless() {
    setLoading(true);
    setError('');
    try {
      const txt = await sessionApi(SubscriptionService.subscriptionVless());
      setPreview(txt);
      setPreviewType('VLESS');
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('previewFailed', { type: 'VLESS' })));
    } finally {
      setLoading(false);
    }
  }

  const [groups, setGroups] = useState<model_SubscriptionGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState('');

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    setGroupsError('');
    try {
      setGroups(await sessionApi(AdminService.adminListSubscriptionGroups()));
    } catch (e: unknown) {
      setGroupsError(getErrorMessage(e, tCommon('loading')));
    } finally {
      setGroupsLoading(false);
    }
    // tCommon intentionally omitted: useTranslations returns a new identity each
    // render, so including it would make loadGroups unstable and re-fire the
    // effect that calls it, causing an infinite update loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user?.can('subscription:read')) loadGroups();
  }, [user, loadGroups]);

  const { copy: copyToClipboard } = useClipboard();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  async function copyLink(group: model_SubscriptionGroup) {
    const url = apiUrl('/s/' + group.token!);
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopiedId(group.id ?? null);
      setTimeout(() => setCopiedId(null), 1500);
      toast.success(t('linkCopied'));
    } else {
      toast.error(t('linkCopyFailed'));
    }
  }

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      await sessionApi(
        AdminService.adminCreateSubscriptionGroup({ requestBody: { name: newName.trim() } }),
      );
      setCreateOpen(false);
      setNewName('');
      toast.success(t('groupCreated'));
      loadGroups();
    } catch (e: unknown) {
      setCreateError(getErrorMessage(e, t('groupCreateFailed')));
    } finally {
      setCreating(false);
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<model_SubscriptionGroup | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resetTarget, setResetTarget] = useState<model_SubscriptionGroup | null>(null);
  const [resetting, setResetting] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await sessionApi(AdminService.adminDeleteSubscriptionGroup({ id: deleteTarget.id! }));
      toast.success(t('groupDeleted'));
      setDeleteTarget(null);
      loadGroups();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, t('groupDeleteFailed')));
    } finally {
      setDeleting(false);
    }
  }

  async function confirmResetToken() {
    if (!resetTarget) return;
    setResetting(true);
    try {
      await sessionApi(AdminService.adminResetSubscriptionGroupToken({ id: resetTarget.id! }));
      toast.success(t('tokenReset'));
      setResetTarget(null);
      loadGroups();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, t('resetTokenFailed')));
    } finally {
      setResetting(false);
    }
  }

  const [editGroup, setEditGroup] = useState<model_SubscriptionGroup | null>(null);
  const [allNodes, setAllNodes] = useState<model_Node[]>([]);
  const [selectedMacs, setSelectedMacs] = useState<Set<string>>(new Set());
  const [nodeSearch, setNodeSearch] = useState('');
  const [savingNodes, setSavingNodes] = useState(false);
  const [saveNodesError, setSaveNodesError] = useState('');
  const [nodesLoading, setNodesLoading] = useState(false);
  const [nodesLoadError, setNodesLoadError] = useState('');

  async function openEditNodes(group: model_SubscriptionGroup) {
    setEditGroup(group);
    setSaveNodesError('');
    setNodeSearch('');
    setAllNodes([]);
    setSelectedMacs(new Set());
    setNodesLoading(true);
    setNodesLoadError('');
    try {
      const [nodes, macs] = await Promise.all([
        sessionApi(AdminService.nodesList({})),
        sessionApi(AdminService.adminGetSubscriptionGroupNodes({ id: group.id! })),
      ]);
      setAllNodes(nodes);
      setSelectedMacs(new Set(macs));
    } catch (e: unknown) {
      setNodesLoadError(getErrorMessage(e, t('groupNodesLoadFailed')));
    } finally {
      setNodesLoading(false);
    }
  }

  function toggleMac(mac: string) {
    setSelectedMacs((prev) => {
      const next = new Set(prev);
      if (next.has(mac)) next.delete(mac);
      else next.add(mac);
      return next;
    });
  }

  async function handleSaveNodes() {
    if (!editGroup) return;
    setSavingNodes(true);
    setSaveNodesError('');
    try {
      await sessionApi(
        AdminService.adminSetSubscriptionGroupNodes({
          id: editGroup.id!,
          requestBody: { nodes: Array.from(selectedMacs) },
        }),
      );
      setEditGroup(null);
      toast.success(t('groupNodesSaved'));
      loadGroups();
    } catch (e: unknown) {
      setSaveNodesError(getErrorMessage(e, t('groupNodesSaveFailed')));
    } finally {
      setSavingNodes(false);
    }
  }

  const deferredNodeSearch = useDeferredValue(nodeSearch);
  const filteredNodes = allNodes.filter((n) => {
    const q = deferredNodeSearch.toLowerCase();
    return (
      (n.hostname ?? '').toLowerCase().includes(q) ||
      n.location?.toLowerCase().includes(q) ||
      (n.mac ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <PageContainer width="wide">
      <PageHeader
        icon={<BookOpen />}
        title={tNav('subscriptions')}
        description={t('vlessDesc')}
      />

      {/* Subscription format cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card
          className="bg-card border rounded-xl animate-slide-up"
          style={{ animationDelay: '40ms' }}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-md-primary-container">
                <Download className="h-4 w-4 text-md-on-primary-container" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="font-display text-base font-600">{t('vless')}</CardTitle>
                <CardDescription className="text-xs">{t('vlessDesc')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex gap-2 pt-0">
            <Button
              variant="outline"
              className="state-layer rounded-lg text-sm font-500 border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              asChild
            >
              <a href={apiPath('/subscription')} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                {tCommon('download')}
              </a>
            </Button>
            <Button
              variant="secondary"
              className="state-layer rounded-lg text-sm font-500 bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              onClick={previewVless}
              disabled={loading}
            >
              {tCommon('preview')}
            </Button>
          </CardContent>
        </Card>

        <Card
          className="bg-card border rounded-xl animate-slide-up"
          style={{ animationDelay: '80ms' }}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-md-tertiary-container">
                <Download className="h-4 w-4 text-md-on-tertiary-container" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="font-display text-base font-600">{t('clashMihomo')}</CardTitle>
                <CardDescription className="text-xs">{t('clashDesc')}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex gap-2 pt-0">
            <Button
              variant="outline"
              className="state-layer rounded-lg text-sm font-500 border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              asChild
            >
              <a href={apiPath('/subscription/clash')} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                {tCommon('download')}
              </a>
            </Button>
            <Button
              variant="secondary"
              className="state-layer rounded-lg text-sm font-500 bg-md-secondary-container text-md-on-secondary-container hover:bg-md-secondary-container focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              onClick={previewClash}
              disabled={loading}
            >
              {tCommon('preview')}
            </Button>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-md-error-container bg-md-error-container px-4 py-3 animate-fade-in">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-md-error shrink-0" />
          <p className="text-sm text-md-on-error-container">{error}</p>
        </div>
      )}

      {preview && (
        <Card className="bg-card border rounded-xl animate-scale-in">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="font-display text-base font-600">
              {t('previewLabel', { type: previewType })}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="state-layer h-8 rounded-lg px-3 text-xs font-500 text-muted-foreground focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              onClick={() => setPreview('')}
            >
              {tCommon('clear')}
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-xl bg-md-surface-container-high p-4 text-xs whitespace-pre-wrap break-all text-foreground">
              {preview}
            </pre>
          </CardContent>
        </Card>
      )}

      {user?.can('subscription:read') && (
        <div className="space-y-4 animate-slide-up" style={{ animationDelay: '120ms' }}>
          {/* Section toolbar */}
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-600 text-foreground">{t('subscriptionGroups')}</h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="state-layer h-8 rounded-lg px-3 text-xs font-500 border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
                onClick={loadGroups}
                disabled={groupsLoading}
              >
                {tCommon('refresh')}
              </Button>
              {canWrite && (
                <Button
                  size="sm"
                  className="state-layer ripple h-8 rounded-lg px-3 text-xs font-500 bg-md-primary text-md-on-primary elevation-1 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
                  onClick={() => { setNewName(''); setCreateError(''); setCreateOpen(true); }}
                >
                  {t('createGroup')}
                </Button>
              )}
            </div>
          </div>

          {groupsError && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-md-error-container bg-md-error-container px-4 py-3">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-md-error shrink-0" />
              <p className="text-sm text-md-on-error-container">{groupsError}</p>
            </div>
          )}

          {groupsLoading ? (
            <div role="status" aria-busy="true" className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-4">
                {/* M3 circular progress indicator */}
                <div className="relative h-10 w-10">
                  <svg
                    aria-hidden="true"
                    className="h-10 w-10 animate-spin"
                    viewBox="0 0 40 40"
                    fill="none"
                    style={{ animationDuration: '1.2s', animationTimingFunction: 'var(--ease-standard)' }}
                  >
                    <circle
                      cx="20" cy="20" r="16"
                      stroke="hsl(var(--md-outline-variant))"
                      strokeWidth="4"
                    />
                    <circle
                      cx="20" cy="20" r="16"
                      stroke="hsl(var(--md-primary))"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray="60 40"
                      strokeDashoffset="0"
                    />
                  </svg>
                </div>
                <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
              </div>
            </div>
          ) : groups.length === 0 ? (
            <div role="status" className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-md-surface-container-high">
                <Download className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="text-sm font-500 text-muted-foreground">{t('noGroups')}</p>
              {canWrite && (
                <Button
                  size="sm"
                  className="state-layer ripple h-9 rounded-lg px-4 text-sm font-500 bg-md-primary text-md-on-primary elevation-1 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
                  onClick={() => { setNewName(''); setCreateError(''); setCreateOpen(true); }}
                >
                  {t('createFirstGroup')}
                </Button>
              )}
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-md-surface-container-high">
                    <th className="px-4 py-3 text-left text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('groupName')}</th>
                    <th className="px-4 py-3 text-left text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colNodeCount')}</th>
                    <th className="px-4 py-3 text-left text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('colSubLink')}</th>
                    {canWrite && <th className="px-4 py-3 text-left text-xs font-500 text-muted-foreground uppercase tracking-wide">{tNodes('colActions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, i) => (
                    <tr
                      key={g.id}
                      className="border-b last:border-0 hover-state animate-slide-up"
                      style={{ animationDelay: `${i * 30}ms` }}
                    >
                      <td className="px-4 py-3 font-display font-600 text-sm text-foreground">{g.name}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-primary-container text-md-on-primary-container">
                          {g.node_count}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <code className="max-w-[200px] truncate rounded-lg bg-md-surface-container-high px-2 py-1 text-xs text-foreground font-mono" title={apiUrl('/s/' + g.token)}>
                            {apiUrl('/s/' + g.token)}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`state-layer h-6 px-2 rounded-lg text-xs font-500 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1 ${
                              copiedId === g.id
                                ? 'bg-md-tertiary-container text-md-on-tertiary-container'
                                : 'text-muted-foreground'
                            }`}
                            onClick={() => copyLink(g)}
                          >
                            {copiedId === g.id ? t('copied') : t('copyLink')}
                          </Button>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={t('showQr')}
                                className="state-layer size-6 p-0 rounded-lg text-muted-foreground focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
                              >
                                <QrCode className="size-3.5" aria-hidden="true" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-4" align="end">
                              <div className="flex flex-col items-center gap-2">
                                <div className="rounded-lg bg-white p-3">
                                  <QRCodeSVG value={apiUrl('/s/' + g.token)} size={160} level="M" />
                                </div>
                                <p className="max-w-[180px] text-center text-xs text-muted-foreground">{t('qrHint')}</p>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
                      </td>
                      {canWrite && (
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="state-layer h-7 rounded-lg px-2.5 text-xs font-500 border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
                              onClick={() => openEditNodes(g)}
                            >
                              {t('editGroupNodes')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="state-layer h-7 rounded-lg px-2.5 text-xs font-500 border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
                              onClick={() => setResetTarget(g)}
                            >
                              {t('resetToken')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="state-layer h-7 rounded-lg px-2.5 text-xs font-500 border border-md-error-container text-destructive hover:bg-md-error-container/30 focus-visible:ring-2 focus-visible:ring-md-error focus-visible:ring-offset-1"
                              onClick={() => setDeleteTarget(g)}
                            >
                              {tCommon('delete')}
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          description={t('createGroupDescription')}
          className="rounded-2xl elevation-3 bg-md-surface-container-low border"
        >
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-600">{t('createGroup')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor={createNameId} className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('groupName')}</Label>
              <Input
                id={createNameId}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('groupNamePlaceholder')}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
                aria-required="true"
                aria-invalid={createError ? true : undefined}
                aria-describedby={createError ? createErrorId : undefined}
                className="rounded-lg border bg-md-surface-container-high focus-visible:ring-2 focus-visible:ring-md-primary"
              />
            </div>
            {createError && (
              <div id={createErrorId} role="alert" className="flex items-center gap-2 rounded-xl border border-md-error-container bg-md-error-container px-3 py-2">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-md-error shrink-0" />
                <p className="text-sm text-md-on-error-container">{createError}</p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="state-layer rounded-lg px-4 text-sm font-500 border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              onClick={() => setCreateOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              loading={creating}
              className="state-layer ripple rounded-lg px-4 text-sm font-500 bg-md-primary text-md-on-primary elevation-1 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              {creating ? t('creating') : t('createGroup')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editGroup} onOpenChange={(open) => { if (!open) setEditGroup(null); }}>
        <DialogContent
          description={t('editGroupNodesDescription')}
          className="max-w-lg rounded-2xl elevation-3 bg-md-surface-container-low border"
        >
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-600">
              {t('editGroupNodes')}{editGroup ? `：${editGroup.name}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor={editSearchId} className="sr-only">{t('searchNodes')}</Label>
            <Input
              id={editSearchId}
              value={nodeSearch}
              onChange={(e) => setNodeSearch(e.target.value)}
              placeholder={t('searchNodes')}
              autoFocus
              disabled={nodesLoading}
              className="rounded-lg border bg-md-surface-container-high focus-visible:ring-2 focus-visible:ring-md-primary"
            />
            <div className="max-h-72 overflow-y-auto space-y-0.5 rounded-xl border bg-md-surface-container p-2">
              {nodesLoading ? (
                <div role="status" aria-busy="true" className="flex items-center justify-center py-8">
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative h-8 w-8">
                      <svg
                        aria-hidden="true"
                        className="h-8 w-8 animate-spin"
                        viewBox="0 0 40 40"
                        fill="none"
                        style={{ animationDuration: '1.2s', animationTimingFunction: 'var(--ease-standard)' }}
                      >
                        <circle cx="20" cy="20" r="16" stroke="hsl(var(--md-outline-variant))" strokeWidth="4" />
                        <circle cx="20" cy="20" r="16" stroke="hsl(var(--md-primary))" strokeWidth="4" strokeLinecap="round" strokeDasharray="60 40" strokeDashoffset="0" />
                      </svg>
                    </div>
                    <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
                  </div>
                </div>
              ) : nodesLoadError ? (
                <div className="flex flex-col items-center gap-3 px-2 py-6">
                  <p className="text-sm text-md-on-error-container text-center">{nodesLoadError}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="state-layer h-7 rounded-lg px-3 text-xs font-500 border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
                    onClick={() => editGroup && openEditNodes(editGroup)}
                  >
                    {tCommon('retry')}
                  </Button>
                </div>
              ) : filteredNodes.length === 0 ? (
                <p className="text-sm text-muted-foreground px-2 py-3 text-center">{tNodes('noMatchingNodes')}</p>
              ) : (
                filteredNodes.map((n, i) => {
                  const mac = n.mac ?? '';
                  const checked = selectedMacs.has(mac);
                  const cbId = `node-cb-${mac.replace(/[^a-zA-Z0-9]/g, '-')}`;
                  return (
                    <label
                      key={mac}
                      htmlFor={cbId}
                      className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover-state animate-slide-up"
                      style={{ animationDelay: `${i * 20}ms` }}
                    >
                      <Checkbox
                        id={cbId}
                        checked={checked}
                        onCheckedChange={() => toggleMac(mac)}
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-500 text-foreground truncate">
                          {n.hostname}
                        </span>
                        {n.location && (
                          <span className="text-xs text-muted-foreground">{n.location}</span>
                        )}
                      </div>
                    </label>
                  );
                })
              )}
            </div>
            {saveNodesError && (
              <div role="alert" className="flex items-center gap-2 rounded-xl border border-md-error-container bg-md-error-container px-3 py-2">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-md-error shrink-0" />
                <p className="text-sm text-md-on-error-container">{saveNodesError}</p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="state-layer rounded-lg px-4 text-sm font-500 border focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              onClick={() => setEditGroup(null)}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              loading={savingNodes}
              disabled={nodesLoading || !!nodesLoadError}
              className="state-layer ripple rounded-lg px-4 text-sm font-500 bg-md-primary text-md-on-primary elevation-1 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              onClick={handleSaveNodes}
            >
              {savingNodes ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent pending={deleting}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('groupDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('groupDeleteConfirm', { name: deleteTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={deleting}
              loadingLabel={tCommon('saving')}
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!resetTarget} onOpenChange={(open) => { if (!open && !resetting) setResetTarget(null); }}>
        <AlertDialogContent pending={resetting}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('resetTokenTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('resetTokenConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={resetting}
              loadingLabel={tCommon('saving')}
              onClick={(e) => { e.preventDefault(); confirmResetToken(); }}
            >
              {t('resetToken')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
