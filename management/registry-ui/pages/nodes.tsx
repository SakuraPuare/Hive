import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { deleteNode, listNodes } from '@/lib/api';
import type { main_Node } from '@/src/generated/client';
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
import { RefreshCw, Trash2, Settings2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { t } from '@/lib/i18n';
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

function formatDate(s: string | undefined | null) {
  if (!s) return t.noData;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function getNodeStatus(n: main_Node): 'online' | 'offline' | 'pending' {
  if (!n.tailscale_ip) return 'pending';
  if (!n.last_seen) return 'offline';
  const diff = Date.now() - new Date(n.last_seen).getTime();
  return diff < 15 * 60 * 1000 ? 'online' : 'offline';
}

const statusLabel: Record<string, string> = {
  online: t.statusOnline,
  offline: t.statusOffline,
  pending: t.statusPending,
};

const statusClass: Record<string, string> = {
  online: 'text-green-600 dark:text-green-400',
  offline: 'text-muted-foreground',
  pending: 'text-yellow-600 dark:text-yellow-400',
};

const columnHelper = createColumnHelper<main_Node>();

const DEFAULT_VISIBILITY: VisibilityState = {
  frp_port: true,
  cf_url: false,
  tunnel_id: false,
  mac6: false,
  note: false,
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
  const [nodes, setNodes] = useState<main_Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'last_seen', desc: true }]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(loadVisibility);
  const [showColMenu, setShowColMenu] = useState(false);

  async function loadNodes() {
    setLoading(true);
    setError('');
    try {
      const list = await listNodes();
      setNodes(list);
    } catch (e: any) {
      setError(e?.error || e?.message || t.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadNodes(); }, []);

  useEffect(() => {
    try { localStorage.setItem(VISIBILITY_KEY, JSON.stringify(columnVisibility)); } catch {}
  }, [columnVisibility]);

  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return nodes;
    const q = searchQuery.toLowerCase();
    return nodes.filter(
      (n) =>
        (n.hostname ?? '').toLowerCase().includes(q) ||
        (n.location ?? '').toLowerCase().includes(q) ||
        (n.tailscale_ip ?? '').toLowerCase().includes(q) ||
        (n.easytier_ip ?? '').toLowerCase().includes(q) ||
        (n.mac ?? '').toLowerCase().includes(q)
    );
  }, [nodes, searchQuery]);

  async function handleDelete(mac: string) {
    if (!window.confirm(t.deleteConfirm(mac))) return;
    try {
      await deleteNode(mac);
      await loadNodes();
    } catch (e: any) {
      setError(e?.error || e?.message || t.deleteFailed);
    }
  }

  function goDetail(mac: string) {
    router.push('/nodes/detail?mac=' + encodeURIComponent(mac));
  }

  const columns = useMemo(() => [
    columnHelper.accessor('location', {
      header: t.colLocation,
      cell: (info) => info.getValue() || t.noData,
    }),
    columnHelper.accessor('hostname', {
      header: t.colHostname,
      cell: (info) => <span className="font-medium">{info.getValue() || t.noData}</span>,
    }),
    columnHelper.accessor('tailscale_ip', {
      header: t.colTailscaleIp,
      cell: (info) => <span className="font-mono text-xs">{info.getValue() || t.noData}</span>,
    }),
    columnHelper.accessor('easytier_ip', {
      header: t.colEasytierIp,
      cell: (info) => <span className="font-mono text-xs">{info.getValue() || t.noData}</span>,
    }),
    columnHelper.accessor('frp_port', {
      id: 'frp_port',
      header: t.colFrpPort,
      cell: (info) => info.getValue() || t.noData,
      enableSorting: false,
    }),
    columnHelper.accessor('mac', {
      header: t.colMac,
      cell: (info) => <span className="font-mono text-xs">{formatMac(info.getValue())}</span>,
      enableSorting: false,
    }),
    columnHelper.accessor('registered_at', {
      header: t.colRegisteredAt,
      cell: (info) => formatDate(info.getValue()),
      sortingFn: 'datetime',
    }),
    columnHelper.accessor('last_seen', {
      header: t.colLastSeen,
      cell: (info) => formatDate(info.getValue()),
      sortingFn: 'datetime',
    }),
    columnHelper.display({
      id: 'status',
      header: t.colStatus,
      cell: ({ row }) => {
        const s = getNodeStatus(row.original);
        return <span className={`text-xs font-medium ${statusClass[s]}`}>{statusLabel[s]}</span>;
      },
      enableSorting: false,
    }),
    // 扩展列（默认隐藏）
    columnHelper.accessor('cf_url', {
      id: 'cf_url',
      header: t.colCfUrl,
      cell: (info) => {
        const v = info.getValue();
        if (!v) return t.noData;
        return <span className="max-w-[120px] truncate block" title={v}>{v}</span>;
      },
      enableSorting: false,
    }),
    columnHelper.accessor('tunnel_id', {
      id: 'tunnel_id',
      header: t.colTunnelId,
      cell: (info) => {
        const v = info.getValue();
        if (!v) return t.noData;
        return <span className="max-w-[80px] truncate block font-mono text-xs" title={v}>{v}</span>;
      },
      enableSorting: false,
    }),
    columnHelper.accessor('mac6', {
      id: 'mac6',
      header: t.colMac6,
      cell: (info) => <span className="font-mono text-xs">{formatMac(info.getValue()) || t.noData}</span>,
      enableSorting: false,
    }),
    columnHelper.accessor('note', {
      id: 'note',
      header: t.colNote,
      cell: (info) => {
        const v = info.getValue();
        if (!v) return t.noData;
        return <span className="max-w-[100px] truncate block" title={v}>{v}</span>;
      },
      enableSorting: false,
    }),
    columnHelper.display({
      id: 'actions',
      header: () => <span className="sr-only">{t.colActions}</span>,
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
  ], []);

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
    { id: 'frp_port', label: t.colFrpPort },
    { id: 'cf_url', label: t.colCfUrl },
    { id: 'tunnel_id', label: t.colTunnelId },
    { id: 'mac6', label: t.colMac6 },
    { id: 'note', label: t.colNote },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t.nodes}</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setShowColMenu((v) => !v)}>
              <Settings2 className="mr-2 h-4 w-4" />
              {t.colSettings}
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
            {t.refresh}
          </Button>
        </div>
      </div>

      <Input
        placeholder={t.searchPlaceholder}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="max-w-sm"
      />

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
                    {t.loading}
                  </TableCell>
                </TableRow>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={table.getVisibleLeafColumns().length} className="text-center text-muted-foreground py-8">
                    {searchQuery ? t.noMatchingNodes : t.noNodesYet}
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        onClick={cell.column.id === 'actions' ? undefined : () => goDetail(row.original.mac!)}
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
