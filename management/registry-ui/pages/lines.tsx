import React, { useCallback, useEffect, useState } from 'react';
import { AdminService } from '@/src/generated/client';
import type { model_Node, model_Line } from '@/src/generated/client';
import { sessionApi, apiPath } from '@/lib/openapi-session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useTranslations } from 'next-intl';
import { useCurrentUser } from '@/lib/auth';
import { useRouter } from 'next/router';

export default function LinesPage() {
  const t = useTranslations('lines');
  const tCommon = useTranslations('common');
  const tNodes = useTranslations('nodes');
  const router = useRouter();
  const { user, loading: authLoading } = useCurrentUser();
  const canWrite = user?.can('line:write') ?? false;

  // ── Lines list ──────────────────────────────────────────────────────
  const [lines, setLines] = useState<model_Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadLines = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setLines(await sessionApi(AdminService.adminListLines()) ?? []);
    } catch (e: any) {
      setError(e?.error || t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!authLoading && user?.can('line:read')) loadLines();
  }, [authLoading, user, loadLines]);

  useEffect(() => {
    if (!authLoading && user && !user.can('line:read')) router.replace('/dashboard');
  }, [authLoading, user, router]);

  // ── Create dialog ───────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createRegion, setCreateRegion] = useState('');
  const [createOrder, setCreateOrder] = useState('0');
  const [createNote, setCreateNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  async function handleCreate() {
    setCreating(true);
    setCreateError('');
    try {
      await sessionApi(AdminService.adminCreateLine({
        requestBody: {
          name: createName,
          region: createRegion,
          display_order: parseInt(createOrder) || 0,
          note: createNote,
        },
      }));
      setShowCreate(false);
      setCreateName('');
      setCreateRegion('');
      setCreateOrder('0');
      setCreateNote('');
      loadLines();
    } catch (e: any) {
      setCreateError(e?.error || t('lineCreateFailed'));
    } finally {
      setCreating(false);
    }
  }

  // ── Edit dialog ─────────────────────────────────────────────────────
  const [editLine, setEditLine] = useState<model_Line | null>(null);
  const [editName, setEditName] = useState('');
  const [editRegion, setEditRegion] = useState('');
  const [editOrder, setEditOrder] = useState('0');
  const [editNote, setEditNote] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState('');

  function openEdit(line: model_Line) {
    setEditLine(line);
    setEditName(line.name ?? '');
    setEditRegion(line.region ?? '');
    setEditOrder(String(line.display_order ?? 0));
    setEditNote(line.note ?? '');
    setEditEnabled(line.enabled ?? true);
    setEditError('');
  }

  async function handleUpdate() {
    if (!editLine) return;
    setEditing(true);
    setEditError('');
    try {
      await sessionApi(AdminService.adminUpdateLine({
        id: editLine.id!,
        requestBody: {
          name: editName,
          region: editRegion,
          display_order: parseInt(editOrder) || 0,
          note: editNote,
          enabled: editEnabled,
        },
      }));
      setEditLine(null);
      loadLines();
    } catch (e: any) {
      setEditError(e?.error || t('lineUpdateFailed'));
    } finally {
      setEditing(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────
  async function handleDelete(line: model_Line) {
    if (!confirm(t('lineDeleteConfirm', { name: line.name ?? '' }))) return;
    try {
      await sessionApi(AdminService.adminDeleteLine({ id: line.id! }));
      loadLines();
    } catch (e: any) {
      alert(e?.error || t('lineDeleteFailed'));
    }
  }

  // ── Node editing dialog ─────────────────────────────────────────────
  const [nodeEditLine, setNodeEditLine] = useState<model_Line | null>(null);
  const [allNodes, setAllNodes] = useState<model_Node[]>([]);
  const [selectedMacs, setSelectedMacs] = useState<Set<string>>(new Set());
  const [nodeSearch, setNodeSearch] = useState('');
  const [savingNodes, setSavingNodes] = useState(false);
  const [saveNodesError, setSaveNodesError] = useState('');

  async function openNodeEdit(line: model_Line) {
    setNodeEditLine(line);
    setNodeSearch('');
    setSaveNodesError('');
    try {
      const [nodes, macs] = await Promise.all([
        sessionApi(AdminService.nodesList({})),
        sessionApi(AdminService.adminGetLineNodes({ id: line.id! })),
      ]);
      setAllNodes(nodes);
      setSelectedMacs(new Set(macs));
    } catch {
      setAllNodes([]);
      setSelectedMacs(new Set());
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

  const filteredNodes = allNodes.filter((n) => {
    if (!nodeSearch) return true;
    const q = nodeSearch.toLowerCase();
    return (
      (n.hostname ?? '').toLowerCase().includes(q) ||
      n.location?.toLowerCase().includes(q) ||
      (n.mac ?? '').toLowerCase().includes(q) ||
      n.tailscale_ip?.toLowerCase().includes(q)
    );
  });

  async function handleSaveNodes() {
    if (!nodeEditLine) return;
    setSavingNodes(true);
    setSaveNodesError('');
    try {
      await sessionApi(AdminService.adminSetLineNodes({
        id: nodeEditLine.id!,
        requestBody: { nodes: Array.from(selectedMacs) },
      }));
      setNodeEditLine(null);
      loadLines();
    } catch (e: any) {
      setSaveNodesError(e?.error || t('lineNodesSaveFailed'));
    } finally {
      setSavingNodes(false);
    }
  }

  // ── Reset token ─────────────────────────────────────────────────────
  async function handleResetToken(line: model_Line) {
    if (!confirm(t('resetTokenConfirm'))) return;
    try {
      await sessionApi(AdminService.adminResetLineToken({ id: line.id! }));
      loadLines();
    } catch (e: any) {
      alert(e?.error || t('resetTokenFailed'));
    }
  }

  // ── Copy link ───────────────────────────────────────────────────────
  const [copiedId, setCopiedId] = useState<number | null>(null);
  function copyLink(line: model_Line) {
    const url = `${window.location.origin}${apiPath(`/l/${line.token}`)}`;
    navigator.clipboard.writeText(url);
    setCopiedId(line.id!);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // ── Render ──────────────────────────────────────────────────────────
  if (authLoading) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('lineManagement')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadLines}>
            {tCommon('refresh')}
          </Button>
          {canWrite && (
            <Button size="sm" onClick={() => setShowCreate(true)}>
              {t('createLine')}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colName')}</TableHead>
                <TableHead>{t('colRegion')}</TableHead>
                <TableHead className="text-center">{t('colOrder')}</TableHead>
                <TableHead className="text-center">{t('colStatus')}</TableHead>
                <TableHead className="text-center">{t('colNodeCount')}</TableHead>
                <TableHead>{t('colSubLink')}</TableHead>
                {canWrite && <TableHead>{t('colActions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={canWrite ? 7 : 6} className="text-center py-8">
                    {tCommon('loading')}
                  </TableCell>
                </TableRow>
              ) : lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canWrite ? 7 : 6} className="text-center py-8">
                    {t('noLines')}
                  </TableCell>
                </TableRow>
              ) : (
                lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">
                      {line.name}
                      {line.note && (
                        <span className="ml-2 text-xs text-muted-foreground">{line.note}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {line.region && <Badge variant="outline">{line.region}</Badge>}
                    </TableCell>
                    <TableCell className="text-center">{line.display_order}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={line.enabled ? 'default' : 'secondary'}>
                        {line.enabled ? t('enabled') : t('disabled')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">{line.node_count}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyLink(line)}
                        >
                          {copiedId === line.id ? t('copied') : t('copyLink')}
                        </Button>
                        {canWrite && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResetToken(line)}
                          >
                            {t('resetToken')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    {canWrite && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(line)}>
                            {tCommon('edit')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openNodeEdit(line)}>
                            {t('editLineNodes')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => handleDelete(line)}
                          >
                            {tCommon('delete')}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createLine')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('lineName')}</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t('lineNamePlaceholder')}
              />
            </div>
            <div>
              <Label>{t('region')}</Label>
              <Input
                value={createRegion}
                onChange={(e) => setCreateRegion(e.target.value)}
                placeholder={t('regionPlaceholder')}
              />
            </div>
            <div>
              <Label>{t('displayOrder')}</Label>
              <Input
                type="number"
                value={createOrder}
                onChange={(e) => setCreateOrder(e.target.value)}
                placeholder={t('displayOrderPlaceholder')}
              />
            </div>
            <div>
              <Label>{t('note')}</Label>
              <Input
                value={createNote}
                onChange={(e) => setCreateNote(e.target.value)}
                placeholder={t('notePlaceholder')}
              />
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
              {creating ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editLine} onOpenChange={(open) => !open && setEditLine(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editLine')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t('lineName')}</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div>
              <Label>{t('region')}</Label>
              <Input value={editRegion} onChange={(e) => setEditRegion(e.target.value)} />
            </div>
            <div>
              <Label>{t('displayOrder')}</Label>
              <Input
                type="number"
                value={editOrder}
                onChange={(e) => setEditOrder(e.target.value)}
              />
            </div>
            <div>
              <Label>{t('note')}</Label>
              <Input value={editNote} onChange={(e) => setEditNote(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Label>{t('colStatus')}</Label>
              <Button
                variant={editEnabled ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setEditEnabled(!editEnabled)}
              >
                {editEnabled ? t('enabled') : t('disabled')}
              </Button>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLine(null)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleUpdate} disabled={editing}>
              {editing ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Node edit dialog */}
      <Dialog open={!!nodeEditLine} onOpenChange={(open) => !open && setNodeEditLine(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t('editLineNodes')} — {nodeEditLine?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={nodeSearch}
              onChange={(e) => setNodeSearch(e.target.value)}
              placeholder={t('searchNodes')}
            />
            <div className="max-h-72 overflow-y-auto space-y-1 rounded-md border p-2">
              {filteredNodes.length === 0 ? (
                <p className="text-sm text-muted-foreground px-2 py-1">
                  {tNodes('noMatchingNodes')}
                </p>
              ) : (
                filteredNodes.map((n) => (
                  <label
                    key={n.mac}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMacs.has(n.mac ?? '')}
                      onChange={() => toggleMac(n.mac ?? '')}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">
                      {n.location ? `【${n.location}】` : ''}
                      {n.hostname}
                    </span>
                  </label>
                ))
              )}
            </div>
            {saveNodesError && <p className="text-sm text-destructive">{saveNodesError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNodeEditLine(null)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleSaveNodes} disabled={savingNodes}>
              {savingNodes ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
