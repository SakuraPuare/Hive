import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MoreVertical, Network } from 'lucide-react';
import { AdminService } from '@/src/generated/client';
import type { model_Node, model_Line } from '@/src/generated/client';
import { sessionApi, apiUrl } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useClipboard } from '@/lib/use-clipboard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslations } from 'next-intl';
import { useCurrentUser } from '@/lib/auth';
import { useRouter } from 'next/router';

function setsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export default function LinesPage() {
  const t = useTranslations('lines');
  const tCommon = useTranslations('common');
  const tNodes = useTranslations('nodes');
  const router = useRouter();
  const toast = useToast();
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

  function resetCreateForm() {
    setCreateName('');
    setCreateRegion('');
    setCreateOrder('0');
    setCreateNote('');
    setCreateError('');
  }

  async function handleCreate() {
    const orderNum = parseInt(createOrder, 10);
    if (isNaN(orderNum) || orderNum < 0) {
      setCreateError(t('invalidOrder'));
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      await sessionApi(AdminService.adminCreateLine({
        requestBody: {
          name: createName,
          region: createRegion,
          display_order: orderNum,
          note: createNote,
        },
      }));
      setShowCreate(false);
      resetCreateForm();
      toast.success(t('lineCreated'));
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
    const orderNum = parseInt(editOrder, 10);
    if (isNaN(orderNum) || orderNum < 0) {
      setEditError(t('invalidOrder'));
      return;
    }
    setEditing(true);
    setEditError('');
    try {
      await sessionApi(AdminService.adminUpdateLine({
        id: editLine.id!,
        requestBody: {
          name: editName,
          region: editRegion,
          display_order: orderNum,
          note: editNote,
          enabled: editEnabled,
        },
      }));
      setEditLine(null);
      toast.success(t('lineUpdated'));
      loadLines();
    } catch (e) {
      setEditError(getErrorMessage(e, t('lineUpdateFailed')));
    } finally {
      setEditing(false);
    }
  }
  // ── Delete (themed confirmation) ────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<model_Line | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await sessionApi(AdminService.adminDeleteLine({ id: deleteTarget.id! }));
      setDeleteTarget(null);
      toast.success(t('lineDeleted'));
      loadLines();
    } catch (e) {
      setDeleteError(getErrorMessage(e, t('lineDeleteFailed')));
    } finally {
      setDeleting(false);
    }
  }

  // ── Reset token (themed confirmation) ───────────────────────────────
  const [resetTarget, setResetTarget] = useState<model_Line | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  async function confirmResetToken() {
    if (!resetTarget) return;
    setResetting(true);
    setResetError('');
    try {
      await sessionApi(AdminService.adminResetLineToken({ id: resetTarget.id! }));
      setResetTarget(null);
      toast.success(t('resetTokenDone'));
      loadLines();
    } catch (e) {
      setResetError(getErrorMessage(e, t('resetTokenFailed')));
    } finally {
      setResetting(false);
    }
  }

  // ── Node editing dialog ─────────────────────────────────────────────
  const [nodeEditLine, setNodeEditLine] = useState<model_Line | null>(null);
  const [allNodes, setAllNodes] = useState<model_Node[]>([]);
  const [selectedMacs, setSelectedMacs] = useState<Set<string>>(new Set());
  const [initialMacs, setInitialMacs] = useState<Set<string>>(new Set());
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
      setInitialMacs(new Set(macs));
    } catch {
      setAllNodes([]);
      setSelectedMacs(new Set());
      setInitialMacs(new Set());
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

  const filteredNodes = useMemo(() => allNodes.filter((n) => {
    if (!nodeSearch) return true;
    const q = nodeSearch.toLowerCase();
    return (
      (n.hostname ?? '').toLowerCase().includes(q) ||
      n.location?.toLowerCase().includes(q) ||
      (n.mac ?? '').toLowerCase().includes(q) ||
      n.tailscale_ip?.toLowerCase().includes(q)
    );
  }), [allNodes, nodeSearch]);

  function selectAllFiltered() {
    setSelectedMacs((prev) => {
      const next = new Set(prev);
      filteredNodes.forEach((n) => n.mac && next.add(n.mac));
      return next;
    });
  }

  function deselectAllFiltered() {
    setSelectedMacs((prev) => {
      const next = new Set(prev);
      filteredNodes.forEach((n) => n.mac && next.delete(n.mac));
      return next;
    });
  }

  const nodesDirty = !setsEqual(selectedMacs, initialMacs);

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
      toast.success(t('lineNodesSaved'));
      loadLines();
    } catch (e) {
      setSaveNodesError(getErrorMessage(e, t('lineNodesSaveFailed')));
    } finally {
      setSavingNodes(false);
    }
  }

  // ── Copy link ───────────────────────────────────────────────────────
  const { copied, copy } = useClipboard();
  const [copiedLineId, setCopiedLineId] = useState<number | null>(null);
  const [copyAnnounce, setCopyAnnounce] = useState('');

  // When hook's `copied` resets to false, clear the per-row id and announcement
  useEffect(() => {
    if (!copied) {
      setCopiedLineId(null);
      setCopyAnnounce('');
    }
  }, [copied]);

  async function copyLink(line: model_Line) {
    const url = apiUrl(`/l/${line.token}`);
    const ok = await copy(url);
    if (ok) {
      setCopiedLineId(line.id!);
      setCopyAnnounce(t('copied'));
    } else {
      toast.error(t('copyFailed'));
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  if (authLoading) return null;

  // derived stats for the header area
  const totalLines = lines.length;
  const enabledLines = lines.filter((l) => l.enabled).length;
  const totalNodes = lines.reduce((acc, l) => acc + (l.node_count ?? 0), 0);
  const selectedCount = filteredNodes.filter((n) => selectedMacs.has(n.mac ?? '')).length;

  return (
    <PageContainer>

      {/* ── Page header ── */}
      <PageHeader
        icon={<Network />}
        title={t('lineManagement')}
        description={totalLines > 0
          ? `${totalLines} ${t('colName').toLowerCase()} · ${enabledLines} ${t('enabled').toLowerCase()} · ${totalNodes} ${t('colNodeCount').toLowerCase()}`
          : null}
        actions={
          <>
            <Button variant="ghost" onClick={loadLines} loading={loading}>
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                <path d="M3 21v-5h5"/>
              </svg>
              {tCommon('refresh')}
            </Button>
            {canWrite && (
              <Button onClick={() => setShowCreate(true)}>
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                {t('createLine')}
              </Button>
            )}
          </>
        }
      />

      {/* ── Error banner ── */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-center gap-3 rounded-xl px-4 py-3
            bg-md-error-container text-md-on-error-container text-sm animate-slide-up"
        >
          <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}

      {/* ── Lines table ── */}
      <Card className="bg-card border rounded-xl overflow-hidden">
        <CardContent className="p-0">
          <Table aria-label={t('lineManagement')}>
            <caption className="sr-only">{t('tableCaption')}</caption>
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
                    <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
                      {/* M3 circular progress indicator */}
                      <svg
                        className="size-10 animate-spin text-md-primary"
                        viewBox="0 0 48 48"
                        fill="none"
                        aria-hidden="true"
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
                      {canWrite && (
                        <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)} className="mt-1">
                          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                            <path d="M12 5v14M5 12h14"/>
                          </svg>
                          {t('createLine')}
                        </Button>
                      )}
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
                          <span className="size-1.5 rounded-full bg-md-tertiary" aria-hidden="true" />
                          {t('enabled')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500
                          bg-muted text-muted-foreground">
                          <span className="size-1.5 rounded-full bg-md-outline" aria-hidden="true" />
                          {t('disabled')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-4 text-center">
                      <span className="font-display text-sm font-600 text-foreground">{line.node_count}</span>
                    </TableCell>
                    <TableCell className="py-4">
                      <div className="flex flex-col gap-1">
                        <a
                          href={apiUrl(`/l/${line.token}`)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={apiUrl(`/l/${line.token}`)}
                          className="font-mono text-xs text-muted-foreground truncate max-w-48 hover:text-foreground transition-colors"
                        >
                          {`/l/${line.token}`}
                        </a>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyLink(line)}
                            className={copiedLineId === line.id ? 'text-md-tertiary' : 'text-muted-foreground'}
                            aria-label={copiedLineId === line.id ? t('copied') : t('copyLink')}
                          >
                            {copiedLineId === line.id ? (
                              <>
                                <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                                {t('copied')}
                              </>
                            ) : (
                              <>
                                <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                                </svg>
                                {t('copyLink')}
                              </>
                            )}
                          </Button>
                          {canWrite && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setResetError(''); setResetTarget(line); }}
                              className="text-muted-foreground"
                            >
                              <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
                                <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
                              </svg>
                              {t('resetToken')}
                            </Button>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    {canWrite && (
                      <TableCell className="py-4 pr-6">
                        {/* Desktop: inline actions */}
                        <div className="hidden items-center gap-1 sm:flex">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(line)}>
                            {tCommon('edit')}
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openNodeEdit(line)} className="text-md-primary">
                            {t('editLineNodes')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setDeleteError(''); setDeleteTarget(line); }}
                            className="text-destructive"
                          >
                            {tCommon('delete')}
                          </Button>
                        </div>
                        {/* Mobile: overflow menu keeps 48dp targets without crowding */}
                        <div className="flex sm:hidden">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-xl" aria-label={t('rowActions', { name: line.name ?? '' })}>
                                <MoreVertical className="size-5" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem size="comfortable" onSelect={() => openEdit(line)}>
                                {tCommon('edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem size="comfortable" onSelect={() => openNodeEdit(line)}>
                                {t('editLineNodes')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                size="comfortable"
                                onSelect={() => { setResetError(''); setResetTarget(line); }}
                              >
                                {t('resetToken')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                size="comfortable"
                                className="text-destructive focus:text-destructive"
                                onSelect={() => { setDeleteError(''); setDeleteTarget(line); }}
                              >
                                {tCommon('delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      {/* sr-only live region for copy-link confirmation */}
      <span className="sr-only" role="status" aria-live="polite">{copyAnnounce}</span>
      {/* ── Create dialog ── */}
      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          setShowCreate(open);
          if (!open) resetCreateForm();
        }}
      >
        <DialogContent size="md">
          <DialogHeader className="pb-2">
            <DialogTitle className="font-display text-xl font-600 text-foreground">
              {t('createLine')}
            </DialogTitle>
            <DialogDescription>{t('createLineDescription')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4 py-2"
            onSubmit={(e) => { e.preventDefault(); if (createName.trim() && !creating) handleCreate(); }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="create-line-name" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('lineName')} <span className="text-md-error" aria-hidden="true">*</span>
              </Label>
              <Input
                id="create-line-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t('lineNamePlaceholder')}
                required
                aria-required="true"
                autoFocus
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-line-region" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('region')}
              </Label>
              <Input
                id="create-line-region"
                value={createRegion}
                onChange={(e) => setCreateRegion(e.target.value)}
                placeholder={t('regionPlaceholder')}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-line-order" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('displayOrder')}
              </Label>
              <Input
                id="create-line-order"
                type="number"
                min="0"
                step="1"
                value={createOrder}
                onChange={(e) => setCreateOrder(e.target.value)}
                placeholder={t('displayOrderPlaceholder')}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-line-note" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('note')}
              </Label>
              <Textarea
                id="create-line-note"
                value={createNote}
                onChange={(e) => setCreateNote(e.target.value)}
                placeholder={t('notePlaceholder')}
                minRows={2}
                maxRows={5}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            {createError && (
              <p role="alert" aria-live="assertive" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs
                bg-md-error-container text-md-on-error-container">
                {createError}
              </p>
            )}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={!createName.trim()} loading={creating}>
              {creating ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={!!editLine} onOpenChange={(open) => !open && setEditLine(null)}>
        <DialogContent size="md">
          <DialogHeader className="pb-2">
            <DialogTitle className="font-display text-xl font-600 text-foreground">
              {t('editLine')}
            </DialogTitle>
            <DialogDescription>{t('editLineDescription')}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4 py-2"
            onSubmit={(e) => { e.preventDefault(); if (editName.trim() && !editing) handleUpdate(); }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="edit-line-name" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('lineName')} <span className="text-md-error" aria-hidden="true">*</span>
              </Label>
              <Input
                id="edit-line-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
                aria-required="true"
                autoFocus
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-line-region" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('region')}
              </Label>
              <Input
                id="edit-line-region"
                value={editRegion}
                onChange={(e) => setEditRegion(e.target.value)}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-line-order" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('displayOrder')}
              </Label>
              <Input
                id="edit-line-order"
                type="number"
                min="0"
                step="1"
                value={editOrder}
                onChange={(e) => setEditOrder(e.target.value)}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-line-note" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('note')}
              </Label>
              <Textarea
                id="edit-line-note"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                minRows={2}
                maxRows={5}
                className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl px-4 py-3 bg-md-surface-container-high/50 border border-border">
              <Label htmlFor="edit-line-enabled" className="text-sm font-500 text-foreground">{t('colStatus')}</Label>
              <Switch
                id="edit-line-enabled"
                checked={editEnabled}
                onCheckedChange={setEditEnabled}
                onLabel={t('enabled')}
                offLabel={t('disabled')}
              />
            </div>
            {editError && (
              <p role="alert" aria-live="assertive" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs
                bg-md-error-container text-md-on-error-container">
                {editError}
              </p>
            )}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditLine(null)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleUpdate} disabled={!editName.trim()} loading={editing}>
              {editing ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Node edit dialog ── */}
      <Dialog open={!!nodeEditLine} onOpenChange={(open) => !open && setNodeEditLine(null)}>
        <DialogContent size="lg">
          <DialogHeader className="pb-2">
            <DialogTitle className="font-display text-xl font-600 text-foreground">
              {t('editLineNodes')}
              {nodeEditLine?.name && (
                <span className="ml-2 text-base font-400 text-muted-foreground">
                  — {nodeEditLine.name}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>{t('editLineNodesDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              value={nodeSearch}
              onValueChange={setNodeSearch}
              debounceMs={300}
              clearable
              clearLabel={tCommon('clear')}
              aria-label={t('searchNodes')}
              placeholder={t('searchNodes')}
              className="rounded-lg bg-md-surface-container-high/50 border-border focus-visible:ring-md-primary"
            />
            <div className="flex items-center justify-between px-0.5 text-xs">
              <span className="text-muted-foreground" role="status" aria-live="polite">
                {t('nodesSelectedCount', { selected: selectedCount, total: filteredNodes.length })}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="link" size="xs" onClick={selectAllFiltered} disabled={filteredNodes.length === 0}>
                  {t('selectAll')}
                </Button>
                <span className="text-md-outline-variant" aria-hidden="true">·</span>
                <Button variant="link" size="xs" onClick={deselectAllFiltered} disabled={selectedCount === 0}>
                  {t('deselectAll')}
                </Button>
              </div>
            </div>
            <ul
              role="list"
              className="max-h-72 overflow-y-auto rounded-xl border border-border
              bg-md-surface-container-lowest divide-y divide-border/60"
            >
              {filteredNodes.length === 0 ? (
                <li role="status" aria-live="polite" className="text-sm text-muted-foreground px-4 py-3">
                  {tNodes('noMatchingNodes')}
                </li>
              ) : (
                filteredNodes.map((n) => {
                  const mac = n.mac ?? '';
                  const label = `${n.location ? `[${n.location}] ` : ''}${n.hostname ?? mac}`;
                  return (
                    <li
                      key={mac}
                      className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover-state transition-colors"
                      onClick={() => toggleMac(mac)}
                    >
                      <Checkbox
                        checked={selectedMacs.has(mac)}
                        onCheckedChange={() => toggleMac(mac)}
                        aria-label={label}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="text-sm text-foreground">
                        {n.location && (
                          <span className="mr-1.5 text-xs text-muted-foreground">[{n.location}]</span>
                        )}
                        {n.hostname}
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
            {saveNodesError && (
              <p role="alert" aria-live="assertive" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs
                bg-md-error-container text-md-on-error-container">
                {saveNodesError}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setNodeEditLine(null)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleSaveNodes} disabled={!nodesDirty} loading={savingNodes}>
              {savingNodes ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent pending={deleting}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteLineTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('lineDeleteConfirm', { name: deleteTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p role="alert" aria-live="assertive" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs
              bg-md-error-container text-md-on-error-container">
              {deleteError}
            </p>
          )}
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

      {/* ── Reset token confirmation ── */}
      <AlertDialog open={!!resetTarget} onOpenChange={(open) => !open && !resetting && setResetTarget(null)}>
        <AlertDialogContent pending={resetting}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('resetTokenTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('resetTokenConfirmNamed', { name: resetTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {resetError && (
            <p role="alert" aria-live="assertive" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs
              bg-md-error-container text-md-on-error-container">
              {resetError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
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


