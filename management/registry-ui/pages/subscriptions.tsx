import React, { useCallback, useEffect, useState } from 'react';
import {
  AdminService,
  SubscriptionService,
} from '@/src/generated/client';
import type { model_Node, model_SubscriptionGroup } from '@/src/generated/client';
import { apiPath, sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCurrentUser } from '@/lib/auth';

export default function Subscriptions() {
  const t = useTranslations('subscriptions');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const tNodes = useTranslations('nodes');
  const { user } = useCurrentUser();
  const canWrite = user?.can('subscription:write') ?? false;

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
  }, []);

  useEffect(() => {
    if (user?.can('subscription:read')) loadGroups();
  }, [user, loadGroups]);

  const [copiedId, setCopiedId] = useState<number | null>(null);
  function copyLink(group: model_SubscriptionGroup) {
    const url = `${apiPath('/s/' + group.token!)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(group.id ?? null);
      setTimeout(() => setCopiedId(null), 1500);
    });
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
      loadGroups();
    } catch (e: unknown) {
      setCreateError(getErrorMessage(e, t('groupCreateFailed')));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(group: model_SubscriptionGroup) {
    if (!confirm(t('groupDeleteConfirm', { name: group.name ?? '' }))) return;
    try {
      await sessionApi(AdminService.adminDeleteSubscriptionGroup({ id: group.id! }));
      loadGroups();
    } catch {
      alert(t('groupDeleteFailed'));
    }
  }

  async function handleResetToken(group: model_SubscriptionGroup) {
    if (!confirm(t('resetTokenConfirm'))) return;
    try {
      await sessionApi(AdminService.adminResetSubscriptionGroupToken({ id: group.id! }));
      loadGroups();
    } catch {
      alert(t('resetTokenFailed'));
    }
  }

  const [editGroup, setEditGroup] = useState<model_SubscriptionGroup | null>(null);
  const [allNodes, setAllNodes] = useState<model_Node[]>([]);
  const [selectedMacs, setSelectedMacs] = useState<Set<string>>(new Set());
  const [nodeSearch, setNodeSearch] = useState('');
  const [savingNodes, setSavingNodes] = useState(false);
  const [saveNodesError, setSaveNodesError] = useState('');

  async function openEditNodes(group: model_SubscriptionGroup) {
    setEditGroup(group);
    setSaveNodesError('');
    setNodeSearch('');
    const [nodes, macs] = await Promise.all([
      sessionApi(AdminService.nodesList({})),
      sessionApi(AdminService.adminGetSubscriptionGroupNodes({ id: group.id! })),
    ]);
    setAllNodes(nodes);
    setSelectedMacs(new Set(macs));
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
      loadGroups();
    } catch (e: unknown) {
      setSaveNodesError(getErrorMessage(e, t('groupNodesSaveFailed')));
    } finally {
      setSavingNodes(false);
    }
  }

  const filteredNodes = allNodes.filter((n) => {
    const q = nodeSearch.toLowerCase();
    return (
      (n.hostname ?? '').toLowerCase().includes(q) ||
      n.location?.toLowerCase().includes(q) ||
      (n.mac ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="animate-slide-up">
        <h1 className="font-display text-3xl font-600 tracking-tight text-foreground">
          {tNav('subscriptions')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('vlessDesc')}</p>
      </div>

      {/* Subscription format cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card
          className="bg-card border rounded-xl animate-slide-up"
          style={{ animationDelay: '40ms' }}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-md-primary-container">
                <Download className="h-4 w-4 text-md-on-primary-container" />
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
                <Download className="mr-2 h-4 w-4" />
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
                <Download className="h-4 w-4 text-md-on-tertiary-container" />
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
                <Download className="mr-2 h-4 w-4" />
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
        <div className="flex items-center gap-2 rounded-xl border border-md-error-container bg-md-error-container px-4 py-3 animate-fade-in">
          <span className="size-1.5 rounded-full bg-md-error shrink-0" />
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
            <div className="flex items-center gap-2 rounded-xl border border-md-error-container bg-md-error-container px-4 py-3">
              <span className="size-1.5 rounded-full bg-md-error shrink-0" />
              <p className="text-sm text-md-on-error-container">{groupsError}</p>
            </div>
          )}

          {groupsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-4">
                {/* M3 circular progress indicator */}
                <div className="relative h-10 w-10">
                  <svg
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
            <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-md-surface-container-high">
                <Download className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-500 text-muted-foreground">{tCommon('noData')}</p>
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
                          <code className="max-w-[200px] truncate rounded-lg bg-md-surface-container-high px-2 py-1 text-xs text-foreground font-mono">
                            {apiPath('/s/' + g.token)}
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
                              onClick={() => handleResetToken(g)}
                            >
                              {t('resetToken')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="state-layer h-7 rounded-lg px-2.5 text-xs font-500 border border-md-error-container text-destructive hover:bg-md-error-container/30 focus-visible:ring-2 focus-visible:ring-md-error focus-visible:ring-offset-1"
                              onClick={() => handleDelete(g)}
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
        <DialogContent className="rounded-2xl elevation-3 bg-md-surface-container-low border">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-600">{t('createGroup')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('groupName')}</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('groupNamePlaceholder')}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                className="rounded-lg border bg-md-surface-container-high focus-visible:ring-2 focus-visible:ring-md-primary"
              />
            </div>
            {createError && (
              <div className="flex items-center gap-2 rounded-xl border border-md-error-container bg-md-error-container px-3 py-2">
                <span className="size-1.5 rounded-full bg-md-error shrink-0" />
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
              className="state-layer ripple rounded-lg px-4 text-sm font-500 bg-md-primary text-md-on-primary elevation-1 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? tCommon('saving') : t('createGroup')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editGroup} onOpenChange={(open) => { if (!open) setEditGroup(null); }}>
        <DialogContent className="max-w-lg rounded-2xl elevation-3 bg-md-surface-container-low border">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-600">
              {t('editGroupNodes')}{editGroup ? `：${editGroup.name}` : ''}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              value={nodeSearch}
              onChange={(e) => setNodeSearch(e.target.value)}
              placeholder={t('searchNodes')}
              className="rounded-lg border bg-md-surface-container-high focus-visible:ring-2 focus-visible:ring-md-primary"
            />
            <div className="max-h-72 overflow-y-auto space-y-0.5 rounded-xl border bg-md-surface-container p-2">
              {filteredNodes.length === 0 ? (
                <p className="text-sm text-muted-foreground px-2 py-3 text-center">{tNodes('noMatchingNodes')}</p>
              ) : (
                filteredNodes.map((n, i) => (
                  <label
                    key={n.mac}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover-state animate-slide-up"
                    style={{ animationDelay: `${i * 20}ms` }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedMacs.has(n.mac ?? '')}
                      onChange={() => toggleMac(n.mac ?? '')}
                      className="h-4 w-4 rounded accent-[hsl(var(--md-primary))]"
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-500 text-foreground truncate">
                        {n.hostname}
                      </span>
                      {n.location && (
                        <span className="text-xs text-muted-foreground">{n.location}</span>
                      )}
                    </div>
                    {selectedMacs.has(n.mac ?? '') && (
                      <span className="ml-auto shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-500 bg-md-primary-container text-md-on-primary-container">
                        ✓
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
            {saveNodesError && (
              <div className="flex items-center gap-2 rounded-xl border border-md-error-container bg-md-error-container px-3 py-2">
                <span className="size-1.5 rounded-full bg-md-error shrink-0" />
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
              className="state-layer ripple rounded-lg px-4 text-sm font-500 bg-md-primary text-md-on-primary elevation-1 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
              onClick={handleSaveNodes}
              disabled={savingNodes}
            >
              {savingNodes ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
