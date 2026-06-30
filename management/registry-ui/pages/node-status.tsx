import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AdminService } from '@/src/generated/client';
import type { model_NodeStatusCheck } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Activity, WifiOff, Wifi } from 'lucide-react';
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

/** M3 §10 status dot */
function statusDot(s: string | undefined) {
  const cls =
    s === 'online'
      ? 'bg-md-tertiary'
      : s === 'offline'
      ? 'bg-md-error'
      : 'bg-md-outline';
  return <span className={`inline-block h-2 w-2 rounded-full ${cls} shrink-0`} />;
}

/** M3 §10 status chip */
function StatusChip({ status }: { status: string | undefined }) {
  if (status === 'online') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-tertiary-container text-md-on-tertiary-container">
        <span className="size-1.5 rounded-full bg-md-tertiary" />
        {status}
      </span>
    );
  }
  if (status === 'offline') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-error-container text-md-on-error-container">
        <span className="size-1.5 rounded-full bg-md-error" />
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-muted text-muted-foreground">
      <span className="size-1.5 rounded-full bg-md-outline" />
      {status ?? '—'}
    </span>
  );
}

function pct(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v.toFixed(1)}%`;
}

/** M3 §10: high-load = error role, medium = warning amber, normal = default */
function pctColor(v: number | null | undefined): string {
  if (v == null) return 'text-muted-foreground';
  if (v >= 90) return 'text-destructive font-600';
  if (v >= 70) return 'text-[hsl(38_92%_42%)] dark:text-[hsl(43_96%_62%)] font-500';
  return 'text-foreground';
}

/** Mini bar indicator for pct columns */
function PctBar({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const fill =
    v >= 90
      ? 'bg-md-error'
      : v >= 70
      ? 'bg-[hsl(43_96%_50%)]'
      : 'bg-md-tertiary';
  return (
    <span className="inline-flex flex-col items-end gap-0.5 min-w-[3.5rem]">
      <span className={`text-xs tabular-nums ${pctColor(v)}`}>{pct(v)}</span>
      <span className="w-full h-1 rounded-full bg-md-surface-container-highest overflow-hidden">
        <span
          className={`block h-full rounded-full ${fill} transition-[width] duration-500`}
          style={{ width: `${Math.min(v, 100)}%` }}
        />
      </span>
    </span>
  );
}

export default function NodeStatusPage() {
  const t = useTranslations('nodeStatus');
  const tCommon = useTranslations('common');
  const [data, setData] = useState<model_NodeStatusCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'online' | 'offline'>('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      setData(await sessionApi(AdminService.adminNodeStatus()) ?? []);
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (filter === 'all') return data;
    return data.filter((n) => n.status === filter);
  }, [data, filter]);

  const onlineCount = data.filter((n) => n.status === 'online').length;
  const offlineCount = data.filter((n) => n.status === 'offline').length;

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Page header ── */}
      <div className="flex flex-col gap-1 animate-slide-up">
        <h1 className="font-display text-2xl font-600 tracking-tight text-foreground">
          {t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.length > 0 && `${data.length} nodes · ${onlineCount} online · ${offlineCount} offline`}
        </p>
      </div>

      {/* ── Summary stat chips ── */}
      {data.length > 0 && (
        <div className="flex flex-wrap gap-3 animate-slide-up" style={{ animationDelay: '40ms' }}>
          {/* Total */}
          <div className="flex items-center gap-2 rounded-xl bg-card border px-4 py-2.5 elevation-1">
            <Activity className="size-4 text-md-primary" />
            <span className="text-xs font-500 text-muted-foreground uppercase tracking-wide">Total</span>
            <span className="font-display text-base font-700 text-foreground">{data.length}</span>
          </div>
          {/* Online */}
          <div className="flex items-center gap-2 rounded-xl bg-md-tertiary-container border-0 px-4 py-2.5">
            <Wifi className="size-4 text-md-tertiary" />
            <span className="text-xs font-500 text-md-on-tertiary-container uppercase tracking-wide">Online</span>
            <span className="font-display text-base font-700 text-md-on-tertiary-container">{onlineCount}</span>
          </div>
          {/* Offline */}
          {offlineCount > 0 && (
            <div className="flex items-center gap-2 rounded-xl bg-md-error-container border-0 px-4 py-2.5">
              <WifiOff className="size-4 text-md-error" />
              <span className="text-xs font-500 text-md-on-error-container uppercase tracking-wide">Offline</span>
              <span className="font-display text-base font-700 text-md-on-error-container">{offlineCount}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Toolbar: filter pills + refresh ── */}
      <div
        className="flex items-center justify-between gap-4 animate-slide-up"
        style={{ animationDelay: '80ms' }}
      >
        {/* Filter segment */}
        <div className="flex rounded-xl border bg-card overflow-hidden text-sm">
          {(['all', 'online', 'offline'] as const).map((f) => (
            <button
              type="button"
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={[
                'state-layer px-4 py-1.5 text-sm font-500 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-inset',
                filter === f
                  ? 'bg-md-secondary-container text-md-on-secondary-container'
                  : 'text-muted-foreground',
              ].join(' ')}
            >
              <span>
                {t(`filter${f.charAt(0).toUpperCase() + f.slice(1)}`)}
                {f === 'online' && ` (${onlineCount})`}
                {f === 'offline' && ` (${offlineCount})`}
              </span>
            </button>
          ))}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
          className="state-layer rounded-lg gap-1.5 text-sm font-500 focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {tCommon('refresh')}
        </Button>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-center gap-2.5 rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container animate-slide-up">
          <span className="size-1.5 rounded-full bg-md-error shrink-0" />
          {error}
        </div>
      )}

      {/* ── Table card ── */}
      <Card
        className="rounded-xl border overflow-hidden animate-slide-up"
        style={{ animationDelay: '120ms' }}
      >
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-md-surface-container-high border-b border-md-outline-variant">
                <TableHead className="text-xs font-600 text-muted-foreground uppercase tracking-wide py-3">
                  {t('colHostname')}
                </TableHead>
                <TableHead className="text-xs font-600 text-muted-foreground uppercase tracking-wide py-3">
                  {t('colLocation')}
                </TableHead>
                <TableHead className="text-xs font-600 text-muted-foreground uppercase tracking-wide py-3">
                  {t('colStatus')}
                </TableHead>
                <TableHead className="text-xs font-600 text-muted-foreground uppercase tracking-wide py-3 text-right">
                  {t('colCpu')}
                </TableHead>
                <TableHead className="text-xs font-600 text-muted-foreground uppercase tracking-wide py-3 text-right">
                  {t('colMem')}
                </TableHead>
                <TableHead className="text-xs font-600 text-muted-foreground uppercase tracking-wide py-3 text-right">
                  {t('colDisk')}
                </TableHead>
                <TableHead className="text-xs font-600 text-muted-foreground uppercase tracking-wide py-3">
                  {t('colUptime')}
                </TableHead>
                <TableHead className="text-xs font-600 text-muted-foreground uppercase tracking-wide py-3 text-right">
                  {t('colLatency')}
                </TableHead>
                <TableHead className="text-xs font-600 text-muted-foreground uppercase tracking-wide py-3">
                  {t('colCheckedAt')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-16 text-center">
                    {/* M3 circular progress indicator */}
                    <div className="inline-flex flex-col items-center gap-3">
                      <span
                        className="inline-block size-8 rounded-full border-2 border-md-primary-container border-t-md-primary animate-spin"
                        aria-hidden="true"
                      />
                      <span className="text-sm text-muted-foreground">{tCommon('loading')}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-16 text-center">
                    <div className="inline-flex flex-col items-center gap-2">
                      <Activity className="size-8 text-md-outline" aria-hidden="true" />
                      <span className="text-sm text-muted-foreground">{t('noData')}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((n, i) => (
                  <TableRow
                    key={n.mac ?? n.hostname}
                    className="hover-state border-b border-md-outline-variant/50 animate-slide-up"
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <TableCell className="py-3 font-mono text-xs text-foreground">
                      {n.hostname}
                    </TableCell>
                    <TableCell className="py-3 text-sm text-muted-foreground">
                      {n.location || '—'}
                    </TableCell>
                    <TableCell className="py-3">
                      <StatusChip status={n.status} />
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      <PctBar v={n.cpu_pct} />
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      <PctBar v={n.mem_pct} />
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      <PctBar v={n.disk_pct} />
                    </TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground">
                      {formatUptime(n.uptime_sec)}
                    </TableCell>
                    <TableCell className="py-3 text-right text-xs tabular-nums text-muted-foreground">
                      {n.latency_ms != null ? (
                        <span className={n.latency_ms > 200 ? 'text-[hsl(38_92%_42%)] dark:text-[hsl(43_96%_62%)]' : 'text-foreground'}>
                          {n.latency_ms}ms
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground">
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
