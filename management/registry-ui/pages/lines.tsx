import React, { useCallback, useEffect, useState } from 'react';
import { AdminService } from '@/src/generated/client';
import type { model_Node, model_Line } from '@/src/generated/client';
import { sessionApi, apiPath } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
    } catch (e) {
      setError(getErrorMessage(e, t('loadFailed')));
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
    } catch (e) {
      setCreateError(getErrorMessage(e, t('lineCreateFailed')));
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
    } catch (e) {
      setEditError(getErrorMessage(e, t('lineUpdateFailed')));
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
    } catch (e) {
      alert(getErrorMessage(e, t('lineDeleteFailed')));
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
    } catch (e) {
      setSaveNodesError(getErrorMessage(e, t('lineNodesSaveFailed')));
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
    } catch (e) {
      alert(getErrorMessage(e, t('resetTokenFailed')));
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

  // derived stats for the header area
  const totalLines = lines.length;
  const enabledLines = lines.filter((l) => l.enabled).length;
  const totalNodes = lines.reduce((acc, l) => acc + (l.node_count ?? 0), 0);

  return (
    <div className="space-y-8 animate-fade-in">

      {/* ── Page header ── */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-600 tracking-tight text-foreground">
            {t('lineManagement')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalLines > 0
              ? `${totalLines} ${t('colName').toLowerCase()} · ${enabledLines} ${t('enabled').toLowerCase()} · ${totalNodes} ${t('colNodeCount').toLowerCase()}`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-3 sm:mt-0">
          <button
            onClick={loadLines}
            className="state-layer inline-flex items-center justify-center gap-2 rounded-lg
              px-4 py-2 text-sm font-500
              bg-md-surface-container-high text-foreground border border-border
              transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
            {tCommon('refresh')}
          </button>
          {canWrite && (
            <button
              onClick={() => setShowCreate(true)}
              className="state-layer ripple inline-flex items-center justify-center gap-2 rounded-lg
                px-4 py-2 text-sm font-500
                bg-md-primary text-md-on-primary elevation-1
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              {t('createLine')}
            </button>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3
          bg-md-error-container text-md-on-error-container text-sm animate-slide-up">
          <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}

      {/* ── Lines table ── */}
      <Card className="bg-card border rounded-xl overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-md-surface-container-high/60 border-b border-border">
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide py-3 pl-6">{t('colName')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide py-3">{t('colRegion')}</TableHead>
                <TableHead className="text-center text-xs font-500 text-muted-foreground uppercase tracking-wide py-3">{t('colOrder')}</TableHead>
                <TableHead className="text-center text-xs font-500 text-muted-foreground uppercase tracking-wide py-3">{t('colStatus')}</TableHead>
                <TableHead className="text-center text-xs font-500 text-muted-foreground uppercase tracking-wide py-3">{t('colNodeCount')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide py-3">{t('colSubLink')}</TableHead>
                {canWrite && <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide py-3 pr-6">{t('colActions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={canWrite ? 7 : 6} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-4">
                      {/* M3 circular progress indicator */}
                      <svg
                        className="size-10 animate-spin text-md-primary"
                        viewBox="0 0 48 48"
                        fill="none"
                        aria-label={tCommon('loading')}
                      >
                        <circle
                          cx="24" cy="24" r="20"
                          stroke="currentColor"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray="100 28"
                          className="opacity-90"
                        />
                      </svg>
                      <span className="text-sm text-muted-foreground">{tCommon('loading')}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canWrite ? 7 : 6} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3 animate-slide-up">
                      <span className="flex size-12 items-center justify-center rounded-full bg-md-surface-container-high">
                        <svg className="size-6 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 10H3M16 2v4M8 2v4M3 6h18a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/>
                        </svg>
                      </span>
                      <p className="text-sm text-muted-foreground">{t('noLines')}</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                lines.map((line, i) => (
                  <TableRow
                    key={line.id}
                    className="hover-state border-b border-border/60 last:border-0 animate-slide-up"
                    style={{ animationDelay: `${i * 35}ms` }}
                  >
                    <TableCell className="py-4 pl-6">
                      <span className="font-500 text-foreground">{line.name}</span>
                      {line.note && (
                        <span className="ml-2 text-xs text-muted-foreground">{line.note}</span>
                      )}
                    </TableCell>
                    <TableCell className="py-4">
                      {line.region && (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-500
                          bg-md-secondary-container text-md-on-secondary-container">
                          {line.region}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-4 text-center">
                      <span className="font-display text-sm font-600 text-foreground">{line.display_order}</span>
                    </TableCell>
                    <TableCell className="py-4 text-center">
                      {line.enabled ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500
                          bg-md-tertiary-container text-md-on-tertiary-container">
                          <span className="size-1.5 rounded-full bg-md-tertiary" />
                          {t('enabled')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500
                          bg-muted text-muted-foreground">
                          <span className="size-1.5 rounded-full bg-md-outline" />
                          {t('disabled')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-4 text-center">
                      <span className="font-display text-sm font-600 text-foreground">{line.node_count}</span>
                    </TableCell>
                    <TableCell className="py-4">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => copyLink(line)}
                          className="state-layer inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-500
                            transition-colors
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
                          style={copiedId === line.id
                            ? { '--state-color': 'hsl(var(--md-tertiary))' } as React.CSSProperties
                            : { '--state-color': 'hsl(var(--md-on-surface))' } as React.CSSProperties
                          }
                        >
                          {copiedId === line.id ? (
                            <>
                              <svg className="size-3 text-md-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                              <span className="text-md-tertiary">{t('copied')}</span>
                            </>
                          ) : (
                            <>
                              <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                              </svg>
                              {t('copyLink')}
                            </>
                          )}
                        </button>
                        {canWrite && (
                          <button
                            onClick={() => handleResetToken(line)}
                            className="state-layer inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-500 text-muted-foreground
                              transition-colors
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
                          >
                            <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                              <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
                              <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
                            </svg>
                            {t('resetToken')}
                          </button>
                        )}
                      </div>
                    </TableCell>
                    {canWrite && (
                      <TableCell className="py-4 pr-6">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(line)}
                            className="state-layer inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-500 text-foreground
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
                          >
                            {tCommon('edit')}
                          </button>
                          <button
                            onClick={() => openNodeEdit(line)}
                            className="state-layer inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-500 text-md-primary
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1"
                          >
                            {t('editLineNodes')}
                          </button>
                          <button
                            onClick={() => handleDelete(line)}
                            className="state-layer inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-500 text-destructive
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-error focus-visible:ring-offset-1"
                            style={{ '--state-color': 'hsl(var(--md-error))' } as React.CSSProperties}
                          >
                            {tCommon('delete')}
                          </button>
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

      {/* ── Create dialog ── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="rounded-2xl border border-border bg-card elevation-3 max-w-md">
          <DialogHeader className="pb-2">
            <DialogTitle className="font-display text-xl font-600 text-foreground">
              {t('createLine')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('lineName')}
              </Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t('lineNamePlaceholder')}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('region')}
              </Label>
              <Input
                value={createRegion}
                onChange={(e) => setCreateRegion(e.target.value)}
                placeholder={t('regionPlaceholder')}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('displayOrder')}
              </Label>
              <Input
                type="number"
                value={createOrder}
                onChange={(e) => setCreateOrder(e.target.value)}
                placeholder={t('displayOrderPlaceholder')}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('note')}
              </Label>
              <Input
                value={createNote}
                onChange={(e) => setCreateNote(e.target.value)}
                placeholder={t('notePlaceholder')}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            {createError && (
              <p className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs
                bg-md-error-container text-md-on-error-container">
                {createError}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setShowCreate(false)}
              className="state-layer inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-500
                bg-md-surface-container-high text-foreground border border-border
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !createName.trim()}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-500
                bg-md-primary text-md-on-primary elevation-1
                disabled:opacity-50 disabled:pointer-events-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {creating ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={!!editLine} onOpenChange={(open) => !open && setEditLine(null)}>
        <DialogContent className="rounded-2xl border border-border bg-card elevation-3 max-w-md">
          <DialogHeader className="pb-2">
            <DialogTitle className="font-display text-xl font-600 text-foreground">
              {t('editLine')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('lineName')}
              </Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('region')}
              </Label>
              <Input
                value={editRegion}
                onChange={(e) => setEditRegion(e.target.value)}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('displayOrder')}
              </Label>
              <Input
                type="number"
                value={editOrder}
                onChange={(e) => setEditOrder(e.target.value)}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('note')}
              </Label>
              <Input
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl px-4 py-3 bg-md-surface-container-high/50 border border-border">
              <Label className="text-sm font-500 text-foreground">{t('colStatus')}</Label>
              <button
                onClick={() => setEditEnabled(!editEnabled)}
                className={[
                  'state-layer inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-500 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1',
                  editEnabled
                    ? 'bg-md-tertiary-container text-md-on-tertiary-container'
                    : 'bg-muted text-muted-foreground',
                ].join(' ')}
              >
                <span className={['size-1.5 rounded-full', editEnabled ? 'bg-md-tertiary' : 'bg-md-outline'].join(' ')} />
                {editEnabled ? t('enabled') : t('disabled')}
              </button>
            </div>
            {editError && (
              <p className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs
                bg-md-error-container text-md-on-error-container">
                {editError}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setEditLine(null)}
              className="state-layer inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-500
                bg-md-surface-container-high text-foreground border border-border
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleUpdate}
              disabled={editing}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-500
                bg-md-primary text-md-on-primary elevation-1
                disabled:opacity-50 disabled:pointer-events-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {editing ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Node edit dialog ── */}
      <Dialog open={!!nodeEditLine} onOpenChange={(open) => !open && setNodeEditLine(null)}>
        <DialogContent className="rounded-2xl border border-border bg-card elevation-3 max-w-lg">
          <DialogHeader className="pb-2">
            <DialogTitle className="font-display text-xl font-600 text-foreground">
              {t('editLineNodes')}
              {nodeEditLine?.name && (
                <span className="ml-2 text-base font-400 text-muted-foreground">
                  — {nodeEditLine.name}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              value={nodeSearch}
              onChange={(e) => setNodeSearch(e.target.value)}
              placeholder={t('searchNodes')}
              className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
            />
            <div className="max-h-72 overflow-y-auto rounded-xl border border-border
              bg-md-surface-container-lowest divide-y divide-border/60">
              {filteredNodes.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-3">
                  {tNodes('noMatchingNodes')}
                </p>
              ) : (
                filteredNodes.map((n) => (
                  <label
                    key={n.mac}
                    className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover-state transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMacs.has(n.mac ?? '')}
                      onChange={() => toggleMac(n.mac ?? '')}
                      className="h-4 w-4 rounded accent-md-primary"
                    />
                    <span className="text-sm text-foreground">
                      {n.location && (
                        <span className="mr-1.5 text-xs text-muted-foreground">[{n.location}]</span>
                      )}
                      {n.hostname}
                    </span>
                  </label>
                ))
              )}
            </div>
            {saveNodesError && (
              <p className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs
                bg-md-error-container text-md-on-error-container">
                {saveNodesError}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => setNodeEditLine(null)}
              className="state-layer inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-500
                bg-md-surface-container-high text-foreground border border-border
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {tCommon('cancel')}
            </button>
            <button
              onClick={handleSaveNodes}
              disabled={savingNodes}
              className="state-layer ripple inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-500
                bg-md-primary text-md-on-primary elevation-1
                disabled:opacity-50 disabled:pointer-events-none
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
            >
              {savingNodes ? tCommon('saving') : tCommon('save')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

