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

function formatDate(s: string | undefined | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
      setError(e?.error || e?.message || 'Failed to load nodes');
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
    if (!window.confirm(`Delete node ${mac}?`)) return;
    try {
      await deleteNode(mac);
      await loadNodes();
    } catch (e: any) {
      setError(e?.error || e?.message || 'Delete failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Nodes</h1>
        <Button variant="outline" onClick={loadNodes} disabled={loading} size="sm">
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Input
        placeholder="Search by hostname, location, IP, or MAC…"
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
                <TableHead>Location</TableHead>
                <TableHead>Hostname</TableHead>
                <TableHead>Tailscale IP</TableHead>
                <TableHead>MAC</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : filteredNodes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    {searchQuery ? 'No matching nodes.' : 'No nodes registered yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredNodes.map((n) => (
                  <TableRow key={n.mac} className="cursor-pointer">
                    <TableCell
                      onClick={() =>
                        router.push('/nodes/detail?mac=' + encodeURIComponent(n.mac))
                      }
                    >
                      {n.location || '—'}
                    </TableCell>
                    <TableCell
                      className="font-medium"
                      onClick={() =>
                        router.push('/nodes/detail?mac=' + encodeURIComponent(n.mac))
                      }
                    >
                      {n.hostname}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs"
                      onClick={() =>
                        router.push('/nodes/detail?mac=' + encodeURIComponent(n.mac))
                      }
                    >
                      {n.tailscale_ip || '—'}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs"
                      onClick={() =>
                        router.push('/nodes/detail?mac=' + encodeURIComponent(n.mac))
                      }
                    >
                      {n.mac}
                    </TableCell>
                    <TableCell
                      onClick={() =>
                        router.push('/nodes/detail?mac=' + encodeURIComponent(n.mac))
                      }
                    >
                      {formatDate(n.last_seen)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <NodeEditDialog node={n} onSave={loadNodes} />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(n.mac)}
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
