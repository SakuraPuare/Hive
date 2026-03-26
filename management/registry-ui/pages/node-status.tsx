import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AdminService } from '@/src/generated/client';
import type { main_NodeStatusCheck } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

function formatUptime(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v.toFixed(1)}%`;
}

function pctColor(v: number | null | undefined): string {
  if (v == null) return '';
  if (v >= 90) return 'text-red-600 dark:text-red-400 font-semibold';
  if (v >= 70) return 'text-yellow-600 dark:text-yellow-400';
  return '';
}

export default function NodeStatusPage() {
  const t = useTranslations('nodeStatus');
  const tCommon = useTranslations('common');
  const [data, setData] = useState<main_NodeStatusCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await sessionApi(AdminService.adminNodeStatus()) ?? []);
    } catch (e: any) {
      setError(e?.message || t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return data;
    return data.filter((n) => n.status === filter);
  }, [data, filter]);

  const statusDot = (s: string | undefined) => {
    const cls = s === 'online' ? 'bg-green-500' : s === 'offline' ? 'bg-red-500' : 'bg-gray-400';
    return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
  };

  const onlineCount = data.filter((n) => n.status === 'online').length;
  const offlineCount = data.filter((n) => n.status === 'offline').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border text-sm">
            {(['all', 'online', 'offline'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 transition-colors ${
                  filter === f ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
                } ${f === 'all' ? 'rounded-l-md' : f === 'offline' ? 'rounded-r-md' : ''}`}
              >
                {t(`filter${f.charAt(0).toUpperCase() + f.slice(1)}` as any)}
                {f === 'online' && ` (${onlineCount})`}
                {f === 'offline' && ` (${offlineCount})`}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {tCommon('refresh')}
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colHostname')}</TableHead>
                <TableHead>{t('colLocation')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead className="text-right">{t('colCpu')}</TableHead>
                <TableHead className="text-right">{t('colMem')}</TableHead>
                <TableHead className="text-right">{t('colDisk')}</TableHead>
                <TableHead>{t('colUptime')}</TableHead>
                <TableHead className="text-right">{t('colLatency')}</TableHead>
                <TableHead>{t('colCheckedAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    {tCommon('loading')}
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    {t('noData')}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((n) => (
                  <TableRow key={n.mac ?? n.hostname}>
                    <TableCell className="font-mono text-xs">{n.hostname}</TableCell>
                    <TableCell className="text-sm">{n.location || '—'}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                        {statusDot(n.status)}
                        {n.status}
                      </span>
                    </TableCell>
                    <TableCell className={`text-right text-xs ${pctColor(n.cpu_pct)}`}>{pct(n.cpu_pct)}</TableCell>
                    <TableCell className={`text-right text-xs ${pctColor(n.mem_pct)}`}>{pct(n.mem_pct)}</TableCell>
                    <TableCell className={`text-right text-xs ${pctColor(n.disk_pct)}`}>{pct(n.disk_pct)}</TableCell>
                    <TableCell className="text-xs">{formatUptime(n.uptime_sec)}</TableCell>
                    <TableCell className="text-right text-xs">
                      {n.latency_ms != null ? `${n.latency_ms}ms` : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {n.checked_at ? new Date(n.checked_at + 'Z').toLocaleString() : '—'}
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
