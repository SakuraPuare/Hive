import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Node } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  RefreshCw, Trash2, Download, MoreHorizontal, Power, PowerOff,
  Server, Wifi, WifiOff, HelpCircle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createColumnHelper } from '@tanstack/react-table';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMac(mac: string | undefined | null) {
  if (!mac || mac.length !== 12) return mac ?? '';
  return mac.match(/.{2}/g)!.join(':');
}

function formatDate(s: string | undefined | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

type ProbeStatus = 'online' | 'offline' | 'unknown';

function getProbeStatus(n: model_Node): ProbeStatus {
  if (n.probe_status === 'online') return 'online';
  if (n.probe_status === 'offline') return 'offline';
  return 'unknown';
}

// M3-compliant status config — §10 recipes
const statusConfig = {
  online: {
    label: 'Online',
    dot: 'bg-md-tertiary',
    cls: 'bg-md-tertiary-container text-md-on-tertiary-container',
  },
  offline: {
    label: 'Offline',
    dot: 'bg-md-error',
    cls: 'bg-md-error-container text-md-on-error-container',
  },
  unknown: {
    label: 'Unknown',
    dot: 'bg-md-outline',
    cls: 'bg-muted text-muted-foreground',
  },
};

function StatusBadge({ status }: { status: ProbeStatus }) {
  const c = statusConfig[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 ${c.cls}`}>
      <span className={`size-1.5 rounded-full shrink-0 ${c.dot}`} />
      {c.label}
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

  const [nodes, setNodes] = useState<model_Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedRows, setSelectedRows] = useState<model_Node[]>([]);

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

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleDelete(mac: string) {
    if (!confirm(t('deleteConfirm', { mac }))) return;
    try {
      await sessionApi(AdminService.nodeDelete({ mac }));
      loadNodes();
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('deleteFailed')));
    }
  }

  async function batchAction(action: 'enable' | 'disable' | 'delete') {
    const macs = selectedRows.map(r => r.mac!);
    if (!macs.length) return;
    if (action === 'delete' && !confirm(t('batchDeleteConfirm', { count: macs.length }))) return;
    for (const mac of macs) {
      if (action === 'delete') await sessionApi(AdminService.nodeDelete({ mac })).catch(() => {});
      else await sessionApi(AdminService.nodeUpdate({ mac, requestBody: { enabled: action === 'enable' } })).catch(() => {});
    }
    loadNodes();
  }

  function exportCSV() {
    const headers = ['note', 'hostname', 'location', 'mac', 'tailscale_ip', 'easytier_ip', 'frp_port', 'status', 'enabled', 'weight', 'region', 'registered_at', 'last_seen'];
    const rows = filteredNodes.map(n => headers.map(h => String((n as Record<string, unknown>)[h] ?? '')));
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `nodes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  // ── Column defs ────────────────────────────────────────────────────────────

  const columns = useMemo(() => [
    col.display({ id: 'probe_status', header: t('colStatus'),
      cell: ({ row }) => <StatusBadge status={getProbeStatus(row.original)} />, enableSorting: false }),
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
      cell: i => <span className="text-muted-foreground">{formatDate(i.getValue())}</span>, sortingFn: 'datetime' }),
    col.accessor('registered_at', { header: t('colRegisteredAt'),
      cell: i => <span className="text-muted-foreground">{formatDate(i.getValue())}</span>, sortingFn: 'datetime' }),
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
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm"
              className="h-8 w-8 p-0 state-layer rounded-lg focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-xl bg-popover border elevation-2 animate-scale-in">
            <DropdownMenuItem
              className="rounded-lg hover-state cursor-pointer"
              onClick={() => router.push('/nodes/detail?mac=' + encodeURIComponent(row.original.mac!))}>
              {tCommon('edit')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="rounded-lg text-destructive focus:text-destructive hover-state cursor-pointer"
              onClick={() => handleDelete(row.original.mac!)}>
              {tCommon('delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, tCommon]);

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
    <div className="space-y-6 animate-fade-in">
      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-600 tracking-tight text-foreground">
            {tNav('nodes')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {counts.all}&nbsp;{t('colStatus').toLowerCase()} &middot;&nbsp;
            <span className="text-md-tertiary">{counts.online} online</span>
            &nbsp;&middot;&nbsp;
            <span className="text-destructive">{counts.offline} offline</span>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={exportCSV}
            className="state-layer rounded-lg gap-1.5 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1">
            <Download className="h-4 w-4" />
            {t('exportCsv')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={loadNodes}
            disabled={loading}
            className="state-layer rounded-lg size-9 p-0 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<Server className="size-4.5" />}
          label="Total"
          value={counts.all}
          accent="primary"
          delay={0}
        />
        <StatCard
          icon={<Wifi className="size-4.5" />}
          label="Online"
          value={counts.online}
          accent="tertiary"
          delay={40}
        />
        <StatCard
          icon={<WifiOff className="size-4.5" />}
          label="Offline"
          value={counts.offline}
          accent="error"
          delay={80}
        />
        <StatCard
          icon={<HelpCircle className="size-4.5" />}
          label="Unknown"
          value={counts.unknown}
          accent="neutral"
          delay={120}
        />
      </div>

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container border border-md-error/20 animate-slide-up">
          {error}
        </div>
      )}

      {/* ── Data table ─────────────────────────────────────────────────────── */}
      <DataTable
        columns={columns}
        data={filteredNodes}
        loading={loading}
        emptyMessage={t('noNodesYet')}
        emptyFilteredMessage={t('noMatchingNodes')}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('searchPlaceholder')}
        enableSelection
        onSelectionChange={setSelectedRows}
        storageKey="nodes"
        columnLabels={columnLabels}
        getRowId={(row) => row.mac!}
        onRowClick={(row) => router.push('/nodes/detail?mac=' + encodeURIComponent(row.mac!))}
        defaultSorting={[{ id: 'last_seen', desc: true }]}
        toolbar={
          /* Status filter tab strip — M3 tonal pill style */
          <div className="flex items-center rounded-xl bg-muted p-0.5 gap-0.5">
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
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-500 transition-all duration-150
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
              onClick={() => batchAction('enable')}
              className="state-layer rounded-lg gap-1.5 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1">
              <Power className="h-3.5 w-3.5" />
              {t('batchEnable')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => batchAction('disable')}
              className="state-layer rounded-lg gap-1.5 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-1">
              <PowerOff className="h-3.5 w-3.5" />
              {t('batchDisable')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => batchAction('delete')}
              className="state-layer ripple rounded-lg gap-1.5 focus-visible:ring-2 focus-visible:ring-md-error focus-visible:ring-offset-1">
              <Trash2 className="h-3.5 w-3.5" />
              {t('batchDelete')}
            </Button>
          </>
        }
      />
    </div>
  );
}
