import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Node } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { NodeEditDialog } from '@/components/nodes/NodeEditDialog';
import { RefreshCw, Trash2, Settings2, ArrowUpDown, ArrowUp, ArrowDown, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';

const VISIBILITY_KEY = 'nodes_col_visibility';

function formatMac(mac: string | undefined | null) {
  if (!mac || mac.length !== 12) return mac ?? '';
  return mac.match(/.{2}/g)!.join(':');
}

function formatDate(s: string | undefined | null, noData: string) {
  if (!s) return noData;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function getNodeStatus(n: model_Node): 'online' | 'offline' | 'unknown' {
  const ps = n.probe_status;
  if (ps === 'online') return 'online';
  if (ps === 'offline') return 'offline';
  return 'unknown';
}

const statusClass: Record<string, string> = {
  online: 'text-green-600 dark:text-green-400',
  offline: 'text-red-600 dark:text-red-400',
  unknown: 'text-muted-foreground',
};

const columnHelper = createColumnHelper<model_Node>();

const DEFAULT_VISIBILITY: VisibilityState = {
  frp_port: true,
  cf_url: false,
  tunnel_id: false,
  mac6: false,
  note: false,
  enabled: false,
  weight: false,
  tags: false,
};

function loadVisibility(): VisibilityState {
  try {
    const raw = localStorage.getItem(VISIBILITY_KEY);
    if (raw) return { ...DEFAULT_VISIBILITY, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_VISIBILITY;
}

export default function Nodes() {
  const router = useRouter();
  const t = useTranslations('nodes');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');

  const [nodes, setNodes] = useState<model_Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'last_seen', desc: true }]);
  // 初始用默认值保证 SSR 与首次客户端渲染一致，mount 后再从 localStorage 同步
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(DEFAULT_VISIBILITY);
  const [showColMenu, setShowColMenu] = useState(false);
  const [selectedMacs, setSelectedMacs] = useState<Set<string>>(new Set());
  const [selectedTag, setSelectedTag] = useState('');

  const statusLabel: Record<string, string> = {
    online: t('statusOnline'),
    offline: t('statusOffline'),
    unknown: t('statusUnknown'),
  };

  async function loadNodes() {
    setLoading(true);
    setError('');
    try {
      const list = await sessionApi(AdminService.nodesList({}));
      setNodes(list);
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadNodes(); }, []);

  // mount 后从 localStorage 恢复列可见性（避免 SSR hydration 不一致）
  useEffect(() => {
    setColumnVisibility(loadVisibility());
  }, []);

  useEffect(() => {
    try { localStorage.setItem(VISIBILITY_KEY, JSON.stringify(columnVisibility)); } catch {}
  }, [columnVisibility]);

  const filteredNodes = useMemo(() => {
    let filtered = nodes;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (n) =>
          (n.hostname ?? '').toLowerCase().includes(q) ||
          (n.location ?? '').toLowerCase().includes(q) ||
          (n.tailscale_ip ?? '').toLowerCase().includes(q) ||
          (n.easytier_ip ?? '').toLowerCase().includes(q) ||
          (n.mac ?? '').toLowerCase().includes(q) ||
          (n.tags ?? '').toLowerCase().includes(q)
      );
    }
    if (selectedTag) {
      filtered = filtered.filter(n => n.tags && n.tags.split(',').map(t => t.trim()).includes(selectedTag));
    }
    return filtered;
  }, [nodes, searchQuery, selectedTag]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    nodes.forEach(n => {
      if (n.tags) n.tags.split(',').forEach(tag => tags.add(tag.trim()));
    });
    return Array.from(tags).sort();
  }, [nodes]);

  async function handleDelete(mac: string) {
    if (!window.confirm(t('deleteConfirm', { mac }))) return;
    try {
      await sessionApi(AdminService.nodeDelete({ mac }));
      await loadNodes();
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('deleteFailed')));
    }
  }

  async function handleBatchDelete() {
    if (!confirm(t('batchDeleteConfirm', { count: selectedMacs.size }))) return;
    for (const mac of selectedMacs) {
      await sessionApi(AdminService.nodeDelete({ mac })).catch(() => {});
    }
    setSelectedMacs(new Set());
    loadNodes();
  }

  async function handleBatchEnable() {
    for (const mac of selectedMacs) {
      await sessionApi(AdminService.nodeUpdate({ mac, requestBody: { enabled: true } })).catch(() => {});
    }
    setSelectedMacs(new Set());
    loadNodes();
  }

  async function handleBatchDisable() {
    for (const mac of selectedMacs) {
      await sessionApi(AdminService.nodeUpdate({ mac, requestBody: { enabled: false } })).catch(() => {});
    }
    setSelectedMacs(new Set());
    loadNodes();
  }

  function handleExportCSV() {
    const headers = ['hostname', 'location', 'mac', 'tailscale_ip', 'easytier_ip', 'status', 'enabled', 'tags', 'registered_at'];
    const rows = filteredNodes.map(n => headers.map(h => String(n[h as keyof model_Node] ?? '')));
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nodes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function goDetail(mac: string) {
    router.push('/nodes/detail?mac=' + encodeURIComponent(mac));
  }

  const noData = tCommon('noData');

  const columns = useMemo(() => [
    columnHelper.display({
      id: 'select',
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getRowModel().rows.length > 0 && selectedMacs.size === table.getRowModel().rows.length}
          onChange={(e) => {
            if (e.target.checked) {
              setSelectedMacs(new Set(table.getRowModel().rows.map(r => r.original.mac!)));
            } else {
              setSelectedMacs(new Set());
            }
          }}
          className="h-4 w-4"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selectedMacs.has(row.original.mac!)}
          onChange={() => {
            const next = new Set(selectedMacs);
            if (next.has(row.original.mac!)) next.delete(row.original.mac!);
            else next.add(row.original.mac!);
            setSelectedMacs(next);
          }}
          className="h-4 w-4"
        />
      ),
    }),
    columnHelper.accessor('location', {
      header: t('colLocation'),
      cell: (info) => info.getValue() || noData,
    }),
    columnHelper.accessor('hostname', {
      header: t('colHostname'),
      cell: (info) => <span className="font-medium">{info.getValue() || noData}</span>,
    }),
    columnHelper.accessor('tailscale_ip', {
      header: t('colTailscaleIp'),
      cell: (info) => <span className="font-mono text-xs">{info.getValue() || noData}</span>,
    }),
    columnHelper.accessor('easytier_ip', {
      header: t('colEasytierIp'),
      cell: (info) => <span className="font-mono text-xs">{info.getValue() || noData}</span>,
    }),
    columnHelper.accessor('frp_port', {
      id: 'frp_port',
      header: t('colFrpPort'),
      cell: (info) => info.getValue() || noData,
      enableSorting: false,
    }),
    columnHelper.accessor('mac', {
      header: t('colMac'),
      cell: (info) => <span className="font-mono text-xs">{formatMac(info.getValue())}</span>,
      enableSorting: false,
    }),
    columnHelper.accessor('registered_at', {
      header: t('colRegisteredAt'),
      cell: (info) => formatDate(info.getValue(), noData),
      sortingFn: 'datetime',
    }),
    columnHelper.accessor('last_seen', {
      header: t('colLastSeen'),
      cell: (info) => formatDate(info.getValue(), noData),
      sortingFn: 'datetime',
    }),
    columnHelper.display({
      id: 'status',
      header: t('colStatus'),
      cell: ({ row }) => {
        const s = getNodeStatus(row.original);
        const dotClass = s === 'online' ? 'bg-green-500' : s === 'offline' ? 'bg-red-500' : 'bg-gray-400';
        return (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${statusClass[s]}`}>
            <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
            {statusLabel[s]}
          </span>
        );
      },
      enableSorting: false,
    }),
    columnHelper.accessor('cf_url', {
      id: 'cf_url',
      header: t('colCfUrl'),
      cell: (info) => {
        const v = info.getValue();
        if (!v) return noData;
        return <span className="max-w-[120px] truncate block" title={v}>{v}</span>;
      },
      enableSorting: false,
    }),
    columnHelper.accessor('tunnel_id', {
      id: 'tunnel_id',
      header: t('colTunnelId'),
      cell: (info) => {
        const v = info.getValue();
        if (!v) return noData;
        return <span className="max-w-[80px] truncate block font-mono text-xs" title={v}>{v}</span>;
      },
      enableSorting: false,
    }),
    columnHelper.accessor('mac6', {
      id: 'mac6',
      header: t('colMac6'),
      cell: (info) => <span className="font-mono text-xs">{formatMac(info.getValue()) || noData}</span>,
      enableSorting: false,
    }),
    columnHelper.accessor('note', {
      id: 'note',
      header: t('colNote'),
      cell: (info) => {
        const v = info.getValue();
        if (!v) return noData;
        return <span className="max-w-[100px] truncate block" title={v}>{v}</span>;
      },
      enableSorting: false,
    }),
    columnHelper.accessor('enabled', {
      id: 'enabled',
      header: t('colEnabled'),
      cell: (info) => info.getValue() ? '✓' : '✗',
      enableSorting: false,
    }),
    columnHelper.accessor('weight', {
      id: 'weight',
      header: t('colWeight'),
      cell: (info) => info.getValue() ?? noData,
      enableSorting: true,
    }),
    columnHelper.accessor('tags', {
      id: 'tags',
      header: t('colTags'),
      cell: (info) => {
        const v = info.getValue();
        if (!v) return noData;
        return <span className="max-w-[120px] truncate block text-xs" title={v}>{v}</span>;
      },
      enableSorting: false,
    }),
    columnHelper.display({
      id: 'actions',
      header: () => <span className="sr-only">{t('colActions')}</span>,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2">
          <NodeEditDialog node={row.original} onSave={loadNodes} />
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); handleDelete(row.original.mac!); }}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
      enableSorting: false,
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [noData, statusLabel]);

  const table = useReactTable({
    data: filteredNodes,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const toggleCols = [
    { id: 'frp_port', label: t('colFrpPort') },
    { id: 'cf_url', label: t('colCfUrl') },
    { id: 'tunnel_id', label: t('colTunnelId') },
    { id: 'mac6', label: t('colMac6') },
    { id: 'note', label: t('colNote') },
    { id: 'enabled', label: t('colEnabled') },
    { id: 'weight', label: t('colWeight') },
    { id: 'tags', label: t('colTags') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{tNav('nodes')}</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setShowColMenu((v) => !v)}>
              <Settings2 className="mr-2 h-4 w-4" />
              {t('colSettings')}
            </Button>
            {showColMenu && (
              <div className="absolute right-0 mt-1 z-50 bg-popover border rounded-md shadow-md p-3 min-w-[140px] space-y-2">
                {toggleCols.map(({ id, label }) => (
                  <label key={id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={columnVisibility[id] !== false}
                      onChange={(e) =>
                        setColumnVisibility((prev) => ({ ...prev, [id]: e.target.checked }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Button variant="outline" onClick={loadNodes} disabled={loading} size="sm">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {tCommon('refresh')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <Download className="mr-1 h-4 w-4" />
            {t('exportCsv')}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder={t('searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-sm"
        />
        {allTags.length > 0 && (
          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{t('allTags')}</option>
            {allTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        )}
      </div>

      {selectedMacs.size > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('selectedCount', { count: selectedMacs.size })}</span>
          <Button size="sm" variant="outline" onClick={handleBatchEnable}>{t('batchEnable')}</Button>
          <Button size="sm" variant="outline" onClick={handleBatchDisable}>{t('batchDisable')}</Button>
          <Button size="sm" variant="destructive" onClick={handleBatchDelete}>{t('batchDelete')}</Button>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive whitespace-pre-wrap">{error}</p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableHead
                        key={header.id}
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                        className={canSort ? 'cursor-pointer select-none' : ''}
                      >
                        <span className="inline-flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            sorted === 'asc' ? <ArrowUp className="h-3 w-3" /> :
                            sorted === 'desc' ? <ArrowDown className="h-3 w-3" /> :
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </span>
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={table.getVisibleLeafColumns().length} className="text-center text-muted-foreground py-8">
                    {tCommon('loading')}
                  </TableCell>
                </TableRow>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={table.getVisibleLeafColumns().length} className="text-center text-muted-foreground py-8">
                    {searchQuery ? t('noMatchingNodes') : t('noNodesYet')}
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        onClick={cell.column.id === 'actions' || cell.column.id === 'select' ? undefined : () => goDetail(row.original.mac!)}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
