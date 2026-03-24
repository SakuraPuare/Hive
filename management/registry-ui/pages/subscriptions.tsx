import React, { useCallback, useEffect, useState } from 'react';
import {
  apiPath,
  createSubscriptionGroup,
  deleteSubscriptionGroup,
  getGroupNodes,
  getSubscriptionClashText,
  getSubscriptionVlessText,
  listNodes,
  listSubscriptionGroups,
  resetGroupToken,
  setGroupNodes,
  type SubscriptionGroup,
} from '@/lib/api';
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
import type { main_Node } from '@/src/generated/client';

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
      const txt = await getSubscriptionClashText();
      setPreview(txt);
      setPreviewType('Clash YAML');
    } catch (e: any) {
      setError(e?.error || t('previewFailed', { type: 'Clash YAML' }));
    } finally {
      setLoading(false);
    }
  }

  async function previewVless() {
    setLoading(true);
    setError('');
    try {
      const txt = await getSubscriptionVlessText();
      setPreview(txt);
      setPreviewType('VLESS');
    } catch (e: any) {
      setError(e?.error || t('previewFailed', { type: 'VLESS' }));
    } finally {
      setLoading(false);
    }
  }

  const [groups, setGroups] = useState<SubscriptionGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState('');

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    setGroupsError('');
    try {
      setGroups(await listSubscriptionGroups());
    } catch (e: any) {
      setGroupsError(e?.error || tCommon('loading'));
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.can('subscription:read')) loadGroups();
  }, [user, loadGroups]);

  const [copiedId, setCopiedId] = useState<number | null>(null);
  function copyLink(group: SubscriptionGroup) {
    const url = `${apiPath('/s/' + group.token)}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(group.id);
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
      await createSubscriptionGroup(newName.trim());
      setCreateOpen(false);
      setNewName('');
      loadGroups();
    } catch (e: any) {
      setCreateError(e?.error || t('groupCreateFailed'));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(group: SubscriptionGroup) {
    if (!confirm(t('groupDeleteConfirm', { name: group.name }))) return;
    try {
      await deleteSubscriptionGroup(group.id);
      loadGroups();
    } catch {
      alert(t('groupDeleteFailed'));
    }
  }

  async function handleResetToken(group: SubscriptionGroup) {
    if (!confirm(t('resetTokenConfirm'))) return;
    try {
      await resetGroupToken(group.id);
      loadGroups();
    } catch {
      alert(t('resetTokenFailed'));
    }
  }

  const [editGroup, setEditGroup] = useState<SubscriptionGroup | null>(null);
  const [allNodes, setAllNodes] = useState<main_Node[]>([]);
  const [selectedMacs, setSelectedMacs] = useState<Set<string>>(new Set());
  const [nodeSearch, setNodeSearch] = useState('');
  const [savingNodes, setSavingNodes] = useState(false);
  const [saveNodesError, setSaveNodesError] = useState('');

  async function openEditNodes(group: SubscriptionGroup) {
    setEditGroup(group);
    setSaveNodesError('');
    setNodeSearch('');
    const [nodes, macs] = await Promise.all([listNodes(), getGroupNodes(group.id)]);
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
      await setGroupNodes(editGroup.id, Array.from(selectedMacs));
      setEditGroup(null);
      loadGroups();
    } catch (e: any) {
      setSaveNodesError(e?.error || t('groupNodesSaveFailed'));
    } finally {
      setSavingNodes(false);
    }
  }

  const filteredNodes = allNodes.filter((n) => {
    const q = nodeSearch.toLowerCase();
    return (
      n.hostname.toLowerCase().includes(q) ||
      n.location?.toLowerCase().includes(q) ||
      n.mac.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{tNav('subscriptions')}</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('vless')}</CardTitle>
            <CardDescription>{t('vlessDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={apiPath('/subscription')} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" />
                {tCommon('download')}
              </a>
            </Button>
            <Button variant="secondary" onClick={previewVless} disabled={loading}>
              {tCommon('preview')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('clashMihomo')}</CardTitle>
            <CardDescription>{t('clashDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={apiPath('/subscription/clash')} target="_blank" rel="noopener noreferrer">
                <Download className="mr-2 h-4 w-4" />
                {tCommon('download')}
              </a>
            </Button>
            <Button variant="secondary" onClick={previewClash} disabled={loading}>
              {tCommon('preview')}
            </Button>
          </CardContent>
        </Card>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {preview && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{t('previewLabel', { type: previewType })}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setPreview('')}>
              {tCommon('clear')}
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs whitespace-pre-wrap break-all">
              {preview}
            </pre>
          </CardContent>
        </Card>
      )}

      {user?.can('subscription:read') && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('subscriptionGroups')}</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadGroups} disabled={groupsLoading}>
                {tCommon('refresh')}
              </Button>
              {canWrite && (
                <Button size="sm" onClick={() => { setNewName(''); setCreateError(''); setCreateOpen(true); }}>
                  {t('createGroup')}
                </Button>
              )}
            </div>
          </div>

          {groupsError && <p className="text-sm text-destructive">{groupsError}</p>}

          {groupsLoading ? (
            <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tCommon('noData')}</p>
          ) : (
            <div className="rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2 text-left font-medium">{t('groupName')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('colNodeCount')}</th>
                    <th className="px-4 py-2 text-left font-medium">{t('colSubLink')}</th>
                    {canWrite && <th className="px-4 py-2 text-left font-medium">{tNodes('colActions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">{g.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">{g.node_count}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <code className="max-w-[200px] truncate rounded bg-muted px-1 py-0.5 text-xs">
                            {apiPath('/s/' + g.token)}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => copyLink(g)}
                          >
                            {copiedId === g.id ? t('copied') : t('copyLink')}
                          </Button>
                        </div>
                      </td>
                      {canWrite && (
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => openEditNodes(g)}
                            >
                              {t('editGroupNodes')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleResetToken(g)}
                            >
                              {t('resetToken')}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs text-destructive hover:text-destructive"
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createGroup')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>{t('groupName')}</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('groupNamePlaceholder')}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{tCommon('cancel')}</Button>
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? tCommon('saving') : t('createGroup')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editGroup} onOpenChange={(open) => { if (!open) setEditGroup(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('editGroupNodes')}{editGroup ? `：${editGroup.name}` : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              value={nodeSearch}
              onChange={(e) => setNodeSearch(e.target.value)}
              placeholder={t('searchNodes')}
            />
            <div className="max-h-72 overflow-y-auto space-y-1 rounded-md border p-2">
              {filteredNodes.length === 0 ? (
                <p className="text-sm text-muted-foreground px-2 py-1">{tNodes('noMatchingNodes')}</p>
              ) : (
                filteredNodes.map((n) => (
                  <label
                    key={n.mac}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMacs.has(n.mac)}
                      onChange={() => toggleMac(n.mac)}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">
                      {n.location ? `【${n.location}】` : ''}{n.hostname}
                    </span>
                  </label>
                ))
              )}
            </div>
            {saveNodesError && <p className="text-sm text-destructive">{saveNodesError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGroup(null)}>{tCommon('cancel')}</Button>
            <Button onClick={handleSaveNodes} disabled={savingNodes}>
              {savingNodes ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
