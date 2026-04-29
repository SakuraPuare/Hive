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
import { NodeEditDialog } from '@/components/nodes/NodeEditDialog';
import {
  RefreshCw, Trash2, Download, MoreHorizontal, Power, PowerOff,
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

const statusConfig = {
  online:  { label: 'Online',  dot: 'bg-emerald-500', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  offline: { label: 'Offline', dot: 'bg-red-500',     cls: 'bg-red-500/10 text-red-700 dark:text-red-400' },
  unknown: { label: 'Unknown', dot: 'bg-gray-400',    cls: 'bg-muted text-muted-foreground' },
};

function StatusBadge({ status }: { status: ProbeStatus }) {
  const c = statusConfig[status];
  return (
    <Badge variant="outline" className={`gap-1.5 border-0 font-medium ${c.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </Badge>
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
  const [selectedTag, setSelectedTag] = useState('');
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
    if (selectedTag)
      result = result.filter(n => n.tags?.split(',').map(s => s.trim()).includes(selectedTag));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(n =>
        [n.hostname, n.location, n.tailscale_ip, n.easytier_ip, n.mac, n.tags, n.note]
          .some(v => v?.toLowerCase().includes(q))
      );
    }
    return result;
  }, [nodes, statusFilter, selectedTag, searchQuery]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    nodes.forEach(n => n.tags?.split(',').forEach(t => { const v = t.trim(); if (v) s.add(v); }));
    return Array.from(s).sort();
  }, [nodes]);

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
    const rows = filteredNodes.map(n => headers.map(h => String((n as any)[h] ?? '')));
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
      cell: i => <span className="font-medium">{i.getValue() || '—'}</span> }),
    col.accessor('hostname', { header: t('colHostname'),
      cell: i => <span className="font-medium">{i.getValue() || '—'}</span> }),
    col.accessor('location', { header: t('colLocation'), cell: i => i.getValue() || '—' }),
    col.accessor('tailscale_ip', { header: t('colTailscaleIp'),
      cell: i => <span className="font-mono text-xs text-muted-foreground">{i.getValue() || '—'}</span> }),
    col.accessor('easytier_ip', { header: t('colEasytierIp'),
      cell: i => <span className="font-mono text-xs text-muted-foreground">{i.getValue() || '—'}</span> }),
    col.accessor('frp_port', { header: t('colFrpPort'),
      cell: i => <span className="font-mono text-xs">{i.getValue() || '—'}</span>, enableSorting: false }),
    col.accessor('mac', { header: t('colMac'),
      cell: i => <span className="font-mono text-xs text-muted-foreground">{formatMac(i.getValue())}</span>, enableSorting: false }),
    col.accessor('mac6', { header: t('colMac6'),
      cell: i => <span className="font-mono text-xs">{i.getValue() || '—'}</span>, enableSorting: false }),
    col.accessor('last_seen', { header: t('colLastSeen'),
      cell: i => <span className="text-muted-foreground">{formatDate(i.getValue())}</span>, sortingFn: 'datetime' }),
    col.accessor('registered_at', { header: t('colRegisteredAt'),
      cell: i => <span className="text-muted-foreground">{formatDate(i.getValue())}</span>, sortingFn: 'datetime' }),
    col.accessor('cf_url', { header: t('colCfUrl'),
      cell: i => { const v = i.getValue(); return v ? <span className="max-w-[140px] truncate block text-xs" title={v}>{v}</span> : '—'; },
      enableSorting: false }),
    col.accessor('tunnel_id', { header: t('colTunnelId'),
      cell: i => { const v = i.getValue(); return v ? <span className="max-w-[80px] truncate block font-mono text-xs" title={v}>{v}</span> : '—'; },
      enableSorting: false }),
    col.accessor('enabled', { header: t('colEnabled'),
      cell: i => i.getValue()
        ? <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-0 text-[10px]">ON</Badge>
        : <Badge className="bg-red-500/10 text-red-700 dark:text-red-400 border-0 text-[10px]">OFF</Badge>,
      enableSorting: false }),
    col.accessor('weight', { header: t('colWeight'), cell: i => i.getValue() ?? '—' }),
    col.accessor('region', { header: t('colRegion'), cell: i => i.getValue() || '—', enableSorting: false }),
    col.display({ id: 'actions', header: () => null, enableSorting: false, enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push('/nodes/detail?mac=' + encodeURIComponent(row.original.mac!))}>
              {tCommon('edit')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive"
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
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tNav('nodes')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {counts.all} total · {counts.online} online · {counts.offline} offline · {counts.unknown} unknown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-1.5" />{t('exportCsv')}
          </Button>
          <Button variant="outline" size="sm" onClick={loadNodes} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

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
          <>
            {/* Status filter tabs */}
            <div className="flex items-center rounded-lg bg-muted p-0.5">
              {(['all', 'online', 'offline', 'unknown'] as StatusFilter[]).map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                    statusFilter === s ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}>
                  {s === 'all' ? `${t('filterAll')} (${counts.all})`
                    : s === 'online' ? `${t('filterOnline')} (${counts.online})`
                    : s === 'offline' ? `${t('filterOffline')} (${counts.offline})`
                    : `${t('statusUnknown')} (${counts.unknown})`}
                </button>
              ))}
            </div>

            {/* Tag filter */}
            {allTags.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    {selectedTag || t('allTags')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setSelectedTag('')}>{t('allTags')}</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {allTags.map(tag => <DropdownMenuItem key={tag} onClick={() => setSelectedTag(tag)}>{tag}</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
        batchActions={
          <>
            <Button size="sm" variant="outline" onClick={() => batchAction('enable')}>
              <Power className="h-3.5 w-3.5 mr-1.5" />{t('batchEnable')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => batchAction('disable')}>
              <PowerOff className="h-3.5 w-3.5 mr-1.5" />{t('batchDisable')}
            </Button>
            <Button size="sm" variant="destructive" onClick={() => batchAction('delete')}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />{t('batchDelete')}
            </Button>
          </>
        }
      />
    </div>
  );
}
