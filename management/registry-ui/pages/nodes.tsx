import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Node } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/toast';
import { NodeEditDialog } from '@/components/nodes/NodeEditDialog';
import {
  RefreshCw, Trash2, Download, MoreHorizontal, Power, PowerOff,
  Server, Wifi, WifiOff, HelpCircle, AlertTriangle, X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createColumnHelper } from '@tanstack/react-table';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { useFormat } from '@/lib/format';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMac(mac: string | undefined | null) {
  if (!mac || mac.length !== 12) return mac ?? '';
  return mac.match(/.{2}/g)!.join(':');
}

type ProbeStatus = 'online' | 'offline' | 'unknown';

function getProbeStatus(n: model_Node): ProbeStatus {
  if (n.probe_status === 'online') return 'online';
  if (n.probe_status === 'offline') return 'offline';
  return 'unknown';
}

// Module-scope so it isn't redefined on every NodesPage render. Takes the
// resolved (i18n-labelled) config entry since labels depend on the active
// locale, which only the page component can read.
function StatusBadge({ config }: { config: { label: string; dot: string; cls: string } }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 ${config.cls}`}>
      <span className={`size-1.5 rounded-full shrink-0 ${config.dot}`} />
      {config.label}
    </span>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: 'primary' | 'tertiary' | 'error' | 'neutral';
  delay?: number;
}

function StatCard({ icon, label, value, accent = 'neutral', delay = 0 }: StatCardProps) {
  const iconCls = {
    primary: 'text-md-primary bg-md-primary-container',
    tertiary: 'text-md-tertiary bg-md-tertiary-container',
    error: 'text-destructive bg-md-error-container',
    neutral: 'text-muted-foreground bg-muted',
  }[accent];

  return (
    <div
      className="bg-card border rounded-xl p-5 flex items-center gap-4 animate-slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`flex items-center justify-center size-10 rounded-full shrink-0 ${iconCls}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-500 text-muted-foreground uppercase tracking-wide leading-none mb-1">{label}</p>
        <p className="font-display text-2xl font-700 text-foreground leading-none">{value}</p>
      </div>
    </div>
  );
}

// ── Columns ──────────────────────────────────────────────────────────────────

const col = createColumnHelper<model_Node>();

type StatusFilter = 'all' | 'online' | 'offline' | 'unknown';

// ── Page ─────────────────────────────────────────────────────────────────────

export default function NodesPage() {
  const router = useRouter();
  const t = useTranslations('nodes');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const toast = useToast();
  const fmt = useFormat();

  const [nodes, setNodes] = useState<model_Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedRows, setSelectedRows] = useState<model_Node[]>([]);
  const [exporting, setExporting] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  // Single-row delete confirmation target (null = closed).
  const [deleteTarget, setDeleteTarget] = useState<model_Node | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Batch delete confirmation.
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  // In-place edit target (null = closed) — replaces the old whole-page nav.
  const [editTarget, setEditTarget] = useState<model_Node | null>(null);

  const loadNodes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setNodes(await sessionApi(AdminService.nodesList({})));
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadNodes(); }, [loadNodes]);

  // Seed statusFilter from URL query params written by dashboard deep-links
  // (?status=online|offline|unknown). Only runs once per navigation, after
  // Next.js hydrates router.query (router.isReady).
  useEffect(() => {
    if (!router.isReady) return;
    const { status } = router.query;
    if (status === 'online' || status === 'offline' || status === 'unknown') {
      setStatusFilter(status);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filteredNodes = useMemo(() => {
    let result = nodes;
    if (statusFilter !== 'all')
      result = result.filter(n => getProbeStatus(n) === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(n =>
        [n.hostname, n.location, n.tailscale_ip, n.easytier_ip, n.mac, n.note]
          .some(v => v?.toLowerCase().includes(q))
      );
    }
    return result;
  }, [nodes, statusFilter, searchQuery]);

  const counts = useMemo(() => {
    const online = nodes.filter(n => n.probe_status === 'online').length;
    const offline = nodes.filter(n => n.probe_status === 'offline').length;
    return { all: nodes.length, online, offline, unknown: nodes.length - online - offline };
  }, [nodes]);

  // M3-compliant status config — labels go through i18n
  const statusConfig = useMemo(() => ({
    online:   { label: t('statusOnline'),   dot: 'bg-md-tertiary', cls: 'bg-md-tertiary-container text-md-on-tertiary-container' },
    offline:  { label: t('statusOffline'),  dot: 'bg-md-error',    cls: 'bg-md-error-container text-md-on-error-container' },
    unknown:  { label: t('statusUnknown'),  dot: 'bg-md-outline',   cls: 'bg-muted text-muted-foreground' },
  }), [t]);

  // ── Actions ────────────────────────────────────────────────────────────────

  // Best-effort human label for a node in confirmations/feedback.
  function nodeLabel(n: model_Node) {
    return n.note || n.hostname || formatMac(n.mac) || n.mac || '—';
  }

  // Run an async op over many nodes with bounded concurrency, collecting
  // per-node failures so callers can report partial success.
  async function runBatch(
    targets: model_Node[],
    op: (n: model_Node) => Promise<unknown>,
  ): Promise<{ ok: number; failed: model_Node[] }> {
    const CONCURRENCY = 5;
    const failed: model_Node[] = [];
    let ok = 0;
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const slice = targets.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(slice.map(op));
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') ok += 1;
        else failed.push(slice[idx]);
      });
    }
    return { ok, failed };
  }

  function reportBatch(ok: number, failed: model_Node[], successMsg: string) {
    if (failed.length === 0) {
      toast.success(successMsg);
    } else if (ok === 0) {
      toast.error(t('batchAllFailed', { count: failed.length }));
    } else {
      toast.error(t('batchPartial', {
        ok,
        failed: failed.length,
        names: failed.slice(0, 3).map(nodeLabel).join('、'),
      }));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget?.mac) return;
    const mac = deleteTarget.mac;
    setDeleting(true);
    try {
      await sessionApi(AdminService.nodeDelete({ mac }));
      toast.success(t('deleteSuccess'));
      setDeleteTarget(null);
      loadNodes();
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, t('deleteFailed')));
    } finally {
      setDeleting(false);
    }
  }

  async function batchToggle(action: 'enable' | 'disable') {
    const targets = selectedRows.filter(r => r.mac);
    if (!targets.length || batchBusy) return;
    setBatchBusy(true);
    try {
      const { ok, failed } = await runBatch(targets, n =>
        sessionApi(AdminService.nodeUpdate({ mac: n.mac!, requestBody: { enabled: action === 'enable' } })));
      reportBatch(ok, failed,
        action === 'enable'
          ? t('batchEnableSuccess', { count: ok })
          : t('batchDisableSuccess', { count: ok }));
      loadNodes();
    } finally {
      setBatchBusy(false);
    }
  }

  async function confirmBatchDelete() {
    const targets = selectedRows.filter(r => r.mac);
    if (!targets.length) return;
    setBatchBusy(true);
    try {
      const { ok, failed } = await runBatch(targets, n =>
        sessionApi(AdminService.nodeDelete({ mac: n.mac! })));
      reportBatch(ok, failed, t('batchDeleteSuccess', { count: ok }));
      setBatchDeleteOpen(false);
      loadNodes();
    } finally {
      setBatchBusy(false);
    }
  }

  function exportCSV() {
    if (exporting) return;
    setExporting(true);
    try {
      const headers = ['note', 'hostname', 'location', 'mac', 'tailscale_ip', 'easytier_ip', 'frp_port', 'status', 'enabled', 'weight', 'region', 'registered_at', 'last_seen'];
      const rows = filteredNodes.map(n => headers.map(h => String((n as Record<string, unknown>)[h] ?? '')));
      const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(','))].join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `nodes-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(t('exportSuccess', { count: filteredNodes.length }));
    } finally {
      setExporting(false);
    }
  }

  // ── Column defs ────────────────────────────────────────────────────────────

  const columns = useMemo(() => [
    col.display({ id: 'probe_status', header: t('colStatus'),
      cell: ({ row }) => <StatusBadge config={statusConfig[getProbeStatus(row.original)]} />, enableSorting: false }),
    col.accessor('note', { header: t('colName'),
      cell: i => <span className="font-display font-600 text-foreground">{i.getValue() || '—'}</span> }),
    col.accessor('hostname', { header: t('colHostname'),
      cell: i => <span className="font-medium text-foreground">{i.getValue() || '—'}</span> }),
    col.accessor('location', { header: t('colLocation'), cell: i => <span className="text-muted-foreground">{i.getValue() || '—'}</span> }),
    col.accessor('tailscale_ip', { header: t('colTailscaleIp'),
      cell: i => <span className="font-mono text-xs text-muted-foreground">{i.getValue() || '—'}</span> }),
    col.accessor('easytier_ip', { header: t('colEasytierIp'),
      cell: i => <span className="font-mono text-xs text-muted-foreground">{i.getValue() || '—'}</span> }),
    col.accessor('frp_port', { header: t('colFrpPort'),
      cell: i => <span className="font-mono text-xs text-muted-foreground">{i.getValue() || '—'}</span>, enableSorting: false }),
    col.accessor('mac', { header: t('colMac'),
      cell: i => <span className="font-mono text-xs text-muted-foreground">{formatMac(i.getValue())}</span>, enableSorting: false }),
    col.accessor('mac6', { header: t('colMac6'),
      cell: i => <span className="font-mono text-xs text-muted-foreground">{i.getValue() || '—'}</span>, enableSorting: false }),
    col.accessor('last_seen', { header: t('colLastSeen'),
      cell: i => <span className="text-muted-foreground">{fmt.dateShort(i.getValue())}</span>, sortingFn: 'datetime' }),
    col.accessor('registered_at', { header: t('colRegisteredAt'),
      cell: i => <span className="text-muted-foreground">{fmt.dateShort(i.getValue())}</span>, sortingFn: 'datetime' }),
    col.accessor('cf_url', { header: t('colCfUrl'),
      cell: i => { const v = i.getValue(); return v ? <span className="max-w-[140px] truncate block text-xs text-muted-foreground" title={v}>{v}</span> : '—'; },
      enableSorting: false }),
    col.accessor('tunnel_id', { header: t('colTunnelId'),
      cell: i => { const v = i.getValue(); return v ? <span className="max-w-[80px] truncate block font-mono text-xs text-muted-foreground" title={v}>{v}</span> : '—'; },
      enableSorting: false }),
    col.accessor('enabled', { header: t('colEnabled'),
      cell: i => i.getValue()
        ? <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-600 bg-md-tertiary-container text-md-on-tertiary-container">ON</span>
        : <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-600 bg-md-error-container text-md-on-error-container">OFF</span>,
      enableSorting: false }),
    col.accessor('weight', { header: t('colWeight'), cell: i => <span className="text-muted-foreground">{i.getValue() ?? '—'}</span> }),
    col.accessor('region', { header: t('colRegion'), cell: i => <span className="text-muted-foreground">{i.getValue() || '—'}</span>, enableSorting: false }),
    col.display({ id: 'actions', header: () => null, enableSorting: false, enableHiding: false,
      meta: { stopRowClick: true },
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm"
              aria-label={t('rowActionsLabel', { name: nodeLabel(row.original) })}
              className="h-8 w-8 p-0 state-layer rounded-lg focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1">
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-xl bg-popover border elevation-2 animate-scale-in">
            <DropdownMenuItem
              className="rounded-lg hover-state cursor-pointer"
              onSelect={() => setEditTarget(row.original)}>
              {tCommon('edit')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="rounded-lg hover-state cursor-pointer"
              onClick={() => router.push('/nodes/detail?mac=' + encodeURIComponent(row.original.mac!))}>
              {tCommon('viewDetails')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="rounded-lg text-destructive focus:text-destructive hover-state cursor-pointer"
              onSelect={() => setDeleteTarget(row.original)}>
              {tCommon('delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, tCommon, fmt, statusConfig]);

  // Column labels for the visibility dropdown
  const columnLabels: Record<string, string> = {
    probe_status: t('colStatus'), note: t('colName'), hostname: t('colHostname'), location: t('colLocation'),
    tailscale_ip: t('colTailscaleIp'), easytier_ip: t('colEasytierIp'),
    frp_port: t('colFrpPort'), mac: t('colMac'), mac6: t('colMac6'),
    last_seen: t('colLastSeen'), registered_at: t('colRegisteredAt'),
    cf_url: t('colCfUrl'), tunnel_id: t('colTunnelId'),
    enabled: t('colEnabled'), weight: t('colWeight'), region: t('colRegion'),
  };

  return (
    <PageContainer>
      {/* ── Page header ────────────────────────────────────────────────────── */}
      <PageHeader
        icon={<Server />}
        title={tNav('nodes')}
        description={
          <>
            {counts.all}&nbsp;{t('colStatus').toLowerCase()} &middot;&nbsp;
            <span className="text-md-tertiary">{counts.online} {t('statusOnline').toLowerCase()}</span>
            &nbsp;&middot;&nbsp;
            <span className="text-destructive">{counts.offline} {t('statusOffline').toLowerCase()}</span>
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCSV}
              loading={exporting}
              className="state-layer rounded-lg gap-1.5 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1">
              {!exporting && <Download className="h-4 w-4" aria-hidden="true" />}
              {t('exportCsv')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={loadNodes}
              disabled={loading}
              aria-label={tCommon('refresh')}
              title={tCommon('refresh')}
              className="state-layer rounded-lg size-9 p-0 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
          </>
        }
      />

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<Server className="size-4.5" aria-hidden="true" />}
          label={t('statTotal')}
          value={counts.all}
          accent="primary"
          delay={0}
        />
        <StatCard
          icon={<Wifi className="size-4.5" aria-hidden="true" />}
          label={t('statusOnline')}
          value={counts.online}
          accent="tertiary"
          delay={40}
        />
        <StatCard
          icon={<WifiOff className="size-4.5" aria-hidden="true" />}
          label={t('statusOffline')}
          value={counts.offline}
          accent="error"
          delay={80}
        />
        <StatCard
          icon={<HelpCircle className="size-4.5" aria-hidden="true" />}
          label={t('statusUnknown')}
          value={counts.unknown}
          accent="neutral"
          delay={120}
        />
      </div>

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container border border-md-error/20 animate-slide-up">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 min-w-0">{error}</p>
          <button
            type="button"
            onClick={() => setError('')}
            aria-label={t('dismissError')}
            className="state-layer -my-1 -mr-1 grid size-8 place-items-center rounded-lg shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-error">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ── Data table ─────────────────────────────────────────────────────── */}
      <DataTable
        columns={columns}
        data={filteredNodes}
        loading={loading}
        emptyMessage={t('noNodesYet')}
        emptyFilteredMessage={t('noMatchingNodes')}
        isFiltered={statusFilter !== 'all'}
        emptyAction={
          (statusFilter !== 'all' || searchQuery.trim()) ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setStatusFilter('all'); setSearchQuery(''); }}
              className="state-layer rounded-lg focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1">
              {t('clearFilters')}
            </Button>
          ) : undefined
        }
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('searchPlaceholder')}
        searchLabel={t('searchLabel')}
        clearSearchLabel={t('clearSearch')}
        enableSelection
        onSelectionChange={setSelectedRows}
        selectAllLabel={t('selectAllLabel')}
        selectRowLabel={t('selectRowLabel')}
        clearSelectionLabel={tCommon('clear')}
        batchRegionLabel={t('batchRegionLabel')}
        renderSelectedCount={(n) => t('selectedCount', { count: n })}
        storageKey="nodes"
        columnLabels={columnLabels}
        columnsLabel={t('colSettings')}
        toggleColumnsLabel={t('colSettings')}
        ariaLabel={tNav('nodes')}
        getRowId={(row) => row.mac!}
        onRowClick={(row) => router.push('/nodes/detail?mac=' + encodeURIComponent(row.mac!))}
        rowRole="link"
        getRowAriaLabel={(row) => t('rowOpenLabel', { name: nodeLabel(row) })}
        pageSizeOptions={[20, 50, 100]}
        rowsPerPageLabel={t('rowsPerPage')}
        paginationLabel={t('paginationLabel')}
        firstPageLabel={t('firstPage')}
        previousPageLabel={t('previousPage')}
        nextPageLabel={t('nextPage')}
        lastPageLabel={t('lastPage')}
        defaultSorting={[{ id: 'last_seen', desc: true }]}
        toolbar={
          /* Status filter tab strip — M3 tonal pill style */
          <div
            role="group"
            aria-label={t('filterByStatus')}
            className="flex items-center rounded-xl bg-muted p-0.5 gap-0.5 overflow-x-auto max-w-full">
            {(['all', 'online', 'offline', 'unknown'] as StatusFilter[]).map(s => {
              const isActive = statusFilter === s;
              const activeExtra =
                s === 'online'  ? 'bg-md-tertiary-container text-md-on-tertiary-container' :
                s === 'offline' ? 'bg-md-error-container text-md-on-error-container' :
                s === 'unknown' ? 'bg-md-surface-container-highest text-foreground' :
                'bg-background text-foreground elevation-1';
              return (
                <button
                  type="button"
                  key={s}
                  aria-pressed={isActive}
                  onClick={() => setStatusFilter(s)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-500 transition-all duration-150
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1
                    ${isActive ? activeExtra : 'text-muted-foreground hover:text-foreground hover:bg-md-surface-container-high'}`}
                >
                  {s === 'all'     ? `${t('filterAll')} (${counts.all})`
                  : s === 'online'  ? `${t('filterOnline')} (${counts.online})`
                  : s === 'offline' ? `${t('filterOffline')} (${counts.offline})`
                  :                   `${t('statusUnknown')} (${counts.unknown})`}
                </button>
              );
            })}
          </div>
        }
        batchActions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => batchToggle('enable')}
              loading={batchBusy}
              disabled={batchBusy}
              className="state-layer rounded-lg gap-1.5 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1">
              {!batchBusy && <Power className="h-3.5 w-3.5" aria-hidden="true" />}
              {t('batchEnable')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => batchToggle('disable')}
              loading={batchBusy}
              disabled={batchBusy}
              className="state-layer rounded-lg gap-1.5 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1">
              {!batchBusy && <PowerOff className="h-3.5 w-3.5" aria-hidden="true" />}
              {t('batchDisable')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setBatchDeleteOpen(true)}
              disabled={batchBusy}
              className="state-layer ripple rounded-lg gap-1.5 focus-visible:ring-2 focus-visible:ring-md-error focus-visible:ring-offset-1">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('batchDelete')}
            </Button>
          </>
        }
      />

      {/* ── In-place node edit ─────────────────────────────────────────────── */}
      <NodeEditDialog
        key={editTarget?.mac ?? 'none'}
        node={editTarget}
        open={editTarget !== null}
        onOpenChange={(o) => { if (!o) setEditTarget(null); }}
        onSaved={() => { setEditTarget(null); loadNodes(); }}
      />

      {/* ── Single-row delete confirmation ─────────────────────────────────── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent pending={deleting}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-full bg-md-error-container text-md-on-error-container shrink-0">
                <AlertTriangle className="size-4" aria-hidden="true" />
              </span>
              {t('deleteNodeTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteNodeBody', {
                name: deleteTarget ? nodeLabel(deleteTarget) : '',
                mac: deleteTarget?.mac ? formatMac(deleteTarget.mac) : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={deleting}
              loadingLabel={tCommon('loading')}
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}>
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Batch delete confirmation ──────────────────────────────────────── */}
      <AlertDialog
        open={batchDeleteOpen}
        onOpenChange={(o) => { if (!o && !batchBusy) setBatchDeleteOpen(false); }}>
        <AlertDialogContent pending={batchBusy} size="md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-full bg-md-error-container text-md-on-error-container shrink-0">
                <AlertTriangle className="size-4" aria-hidden="true" />
              </span>
              {t('batchDeleteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('batchDeleteBody', { count: selectedRows.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selectedRows.length > 0 && (
            <ul className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground max-h-40 overflow-y-auto space-y-0.5">
              {selectedRows.slice(0, 5).map((n) => (
                <li key={n.mac} className="flex items-center justify-between gap-3">
                  <span className="truncate">{nodeLabel(n)}</span>
                  <span className="font-mono text-xs text-muted-foreground shrink-0">{formatMac(n.mac)}</span>
                </li>
              ))}
              {selectedRows.length > 5 && (
                <li className="text-xs text-muted-foreground pt-0.5">
                  {t('batchDeleteMore', { count: selectedRows.length - 5 })}
                </li>
              )}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchBusy}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={batchBusy}
              loadingLabel={tCommon('loading')}
              onClick={(e) => { e.preventDefault(); confirmBatchDelete(); }}>
              {t('batchDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
