import React, { useEffect, useMemo, useState } from 'react';
import { listNodes } from '@/lib/api';
import type { main_Node } from '@/src/generated/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Server, Network, Globe, CalendarPlus } from 'lucide-react';

function StatsCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function formatDate(s: string | undefined | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Dashboard() {
  const [nodes, setNodes] = useState<main_Node[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listNodes()
      .then(setNodes)
      .finally(() => setLoading(false));
  }, []);

  const tailscaleCount = useMemo(
    () => nodes.filter((n) => n.tailscale_ip).length,
    [nodes]
  );
  const cfCount = useMemo(() => nodes.filter((n) => n.cf_url).length, [nodes]);

  const oneWeekAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  }, []);

  const recentNodes = useMemo(() => {
    return nodes
      .filter((n) => {
        if (!n.registered_at) return false;
        const d = new Date(n.registered_at);
        return !isNaN(d.getTime()) && d >= oneWeekAgo;
      })
      .sort((a, b) => {
        return new Date(b.registered_at || 0).getTime() - new Date(a.registered_at || 0).getTime();
      })
      .slice(0, 10);
  }, [nodes, oneWeekAgo]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatsCard title="Total Nodes" value={nodes.length} icon={Server} />
            <StatsCard title="Tailscale Connected" value={tailscaleCount} icon={Network} />
            <StatsCard title="CF Tunnel Active" value={cfCount} icon={Globe} />
            <StatsCard title="New This Week" value={recentNodes.length} icon={CalendarPlus} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recently Registered</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentNodes.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No nodes registered this week.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Hostname</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Tailscale IP</TableHead>
                      <TableHead>Registered At</TableHead>
                      <TableHead>MAC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentNodes.map((n) => (
                      <TableRow key={n.mac}>
                        <TableCell className="font-medium">{n.hostname || '—'}</TableCell>
                        <TableCell>{n.location || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{n.tailscale_ip || '—'}</TableCell>
                        <TableCell>{formatDate(n.registered_at)}</TableCell>
                        <TableCell className="font-mono text-xs">{n.mac}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
