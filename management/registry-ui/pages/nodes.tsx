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
import { RefreshCw, Trash2 } from 'lucide-react';
import { t } from '@/lib/i18n';

function formatDate(s: string | undefined | null) {
  if (!s) return t.noData;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export default function Nodes() {
  const router = useRouter();
  const [nodes, setNodes] = useState<main_Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

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

  useEffect(() => {
    loadNodes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t.nodes}</h1>
        <Button variant="outline" onClick={loadNodes} disabled={loading} size="sm">
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t.refresh}
        </Button>
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
              <TableRow>
                <TableHead>{t.colLocation}</TableHead>
                <TableHead>{t.colHostname}</TableHead>
                <TableHead>{t.colTailscaleIp}</TableHead>
                <TableHead>{t.colEasytierIp}</TableHead>
                <TableHead>{t.colMac}</TableHead>
                <TableHead>{t.colLastSeen}</TableHead>
                <TableHead className="text-right">{t.colActions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {t.loading}
                  </TableCell>
                </TableRow>
              ) : filteredNodes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {searchQuery ? t.noMatchingNodes : t.noNodesYet}
                  </TableCell>
                </TableRow>
              ) : (
                filteredNodes.map((n) => (
                  <TableRow key={n.mac} className="cursor-pointer">
                    <TableCell onClick={() => goDetail(n.mac!)}>{n.location || t.noData}</TableCell>
                    <TableCell className="font-medium" onClick={() => goDetail(n.mac!)}>{n.hostname || t.noData}</TableCell>
                    <TableCell className="font-mono text-xs" onClick={() => goDetail(n.mac!)}>{n.tailscale_ip || t.noData}</TableCell>
                    <TableCell className="font-mono text-xs" onClick={() => goDetail(n.mac!)}>{n.easytier_ip || t.noData}</TableCell>
                    <TableCell className="font-mono text-xs" onClick={() => goDetail(n.mac!)}>{n.mac}</TableCell>
                    <TableCell onClick={() => goDetail(n.mac!)}>{formatDate(n.last_seen)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <NodeEditDialog node={n} onSave={loadNodes} />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(n.mac!)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
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
