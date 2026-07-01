import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AdminService } from '@/src/generated/client';
import type { model_NodeStatusCheck } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  RefreshCw, Activity, WifiOff, Wifi, X, ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

// ── Tunables (single source of truth for thresholds; ideally backend-driven) ──
const POLL_INTERVAL_MS = 30000;
const STALE_THRESHOLD_MS = 120000;
const CPU_WARN = 70;
const CPU_CRIT = 90;
const LATENCY_WARNING_MS = 200;

type FilterKey = 'all' | 'online' | 'offline';
type SortKey =
  | 'hostname' | 'status' | 'cpu' | 'mem' | 'disk' | 'uptime' | 'latency' | 'checkedAt';
type SortState = { key: SortKey | null; dir: 'asc' | 'desc' };

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

/** M3 §10: high-load = error role, medium = warning amber, normal = default */
function pctColor(v: number | null | undefined): string {
  if (v == null) return 'text-muted-foreground';
  if (v >= CPU_CRIT) return 'text-destructive font-600';
  if (v >= CPU_WARN) return 'text-[hsl(38_92%_42%)] dark:text-[hsl(43_96%_62%)] font-500';
  return 'text-foreground';
}

/** Mini bar indicator for pct columns. `sevText` is an already-translated
 *  severity word ('' when normal) so screen readers get the colour semantics. */
function PctBar({ v, sevText }: { v: number | null | undefined; sevText?: string }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const fill =
    v >= CPU_CRIT
      ? 'bg-md-error'
      : v >= CPU_WARN
      ? 'bg-[hsl(43_96%_50%)]'
      : 'bg-md-tertiary';
  const label = sevText ? `${pct(v)} ${sevText}` : pct(v);
  return (
    <span className="inline-flex flex-col items-end gap-0.5 min-w-[3.5rem]" aria-label={label}>
      <span className={`text-xs tabular-nums ${pctColor(v)}`} aria-hidden="true">{pct(v)}</span>
      <span className="w-full h-1 rounded-full bg-md-surface-container-highest overflow-hidden" aria-hidden="true">
        <span
          className={`block h-full rounded-full ${fill} transition-[width] duration-500`}
          style={{ width: `${Math.min(v, 100)}%` }}
        />
      </span>
    </span>
  );
}

/** M3 §10 status chip */
function StatusChip({ status }: { status: string | undefined }) {
  if (status === 'online') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-tertiary-container text-md-on-tertiary-container">
        <span className="size-1.5 rounded-full bg-md-tertiary" aria-hidden="true" />
        {status}
      </span>
    );
  }
  if (status === 'offline') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-error-container text-md-on-error-container">
        <span className="size-1.5 rounded-full bg-md-error" aria-hidden="true" />
        {status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-muted text-muted-foreground">
      <span className="size-1.5 rounded-full bg-md-outline" aria-hidden="true" />
      {status ?? '—'}
    </span>
  );
}

/** Sortable column header: renders a <th aria-sort> with an inner sort button. */
function SortableHead({
  label, sortKey, sort, onSort, sortByLabel, align = 'left', responsive,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (k: SortKey) => void;
  sortByLabel: string;
  align?: 'left' | 'right';
  responsive?: string;
}) {
  const active = sort.key === sortKey;
  const ariaSort: 'ascending' | 'descending' | 'none' = active
    ? (sort.dir === 'asc' ? 'ascending' : 'descending')
    : 'none';
  const Icon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <TableHead aria-sort={ariaSort} className={`py-0 ${responsive ?? ''}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={sortByLabel}
        className={[
          'state-layer rounded-md inline-flex items-center gap-1 py-3 px-1 -mx-1 w-full',
          'text-xs font-600 uppercase tracking-wide transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-inset',
          active ? 'text-foreground' : 'text-muted-foreground',
          align === 'right' ? 'justify-end' : 'justify-start',
        ].join(' ')}
      >
        <span>{label}</span>
        <Icon
          className={`size-3.5 shrink-0 ${active ? 'text-md-primary' : 'text-md-outline'}`}
          aria-hidden="true"
        />
      </button>
    </TableHead>
  );
}

export default function NodeStatusPage() {
  const t = useTranslations('nodeStatus');
  const tCommon = useTranslations('common');
  const [data, setData] = useState<model_NodeStatusCheck[]>([]);
  const [loading, setLoading] = useState(true);     // full-table skeleton (first load only)
  const [refreshing, setRefreshing] = useState(false); // silent background poll
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Roving tabindex anchor for the segmented filter control.
  const filterRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      setData(await sessionApi(AdminService.adminNodeStatus()) ?? []);
      setLastUpdated(new Date());
    } catch (e: unknown) {
      setError(getErrorMessage(e, t('loadFailed')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  // Initial load + 30s silent polling.
  useEffect(() => {
    load();
    const id = setInterval(() => load({ silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Tick so the "updated N ago" relative label stays fresh between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const onlineCount = data.filter((n) => n.status === 'online').length;
  const offlineCount = data.filter((n) => n.status === 'offline').length;

  const filters: FilterKey[] = ['all', 'online', 'offline'];

  const filtered = useMemo(() => {
    const base = filter === 'all' ? data : data.filter((n) => n.status === filter);
    if (!sort.key) return base;
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (n: model_NodeStatusCheck): string | number => {
      switch (sort.key) {
        case 'hostname': return (n.hostname ?? '').toLowerCase();
        case 'status': return n.status ?? '';
        case 'cpu': return n.cpu_pct ?? -1;
        case 'mem': return n.mem_pct ?? -1;
        case 'disk': return n.disk_pct ?? -1;
        case 'uptime': return n.uptime_sec ?? -1;
        case 'latency': return n.latency_ms ?? -1;
        case 'checkedAt': return n.checked_at ? new Date(n.checked_at + 'Z').getTime() : -1;
        default: return 0;
      }
    };
    return [...base].sort((a, b) => {
      const av = val(a); const bv = val(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [data, filter, sort]);

  const onSort = useCallback((key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' });
  }, []);

  // Relative "updated N ago" label.
  const updatedLabel = useMemo(() => {
    if (!lastUpdated) return '';
    const diff = Math.max(0, Math.floor((now - lastUpdated.getTime()) / 1000));
    if (diff < 5) return t('updatedJustNow');
    if (diff < 60) return t('updatedSecondsAgo', { n: diff });
    const mins = Math.floor(diff / 60);
    return t('updatedMinutesAgo', { n: mins });
  }, [lastUpdated, now, t]);

  const isStale = lastUpdated != null && now - lastUpdated.getTime() > STALE_THRESHOLD_MS;

  // Roving keyboard nav for the segmented filter (ARIA radiogroup pattern).
  const onFilterKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % filters.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + filters.length) % filters.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = filters.length - 1;
    else return;
    e.preventDefault();
    setFilter(filters[next]);
    filterRefs.current[next]?.focus();
  };

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Page header ── */}
      <div className="flex flex-col gap-1 animate-slide-up">
        <h1 className="font-display text-2xl font-600 tracking-tight text-foreground">
          {t('title')}
        </h1>
        {/* Reserve height to avoid CLS before data arrives */}
        <p className="text-sm text-muted-foreground min-h-5">
          {data.length > 0
            ? t('summaryLine', { total: data.length, online: onlineCount, offline: offlineCount })
            : !loading && t('monitoringHint')}
        </p>
      </div>

      {/* ── Summary stat chips (live region: announces count changes on poll) ── */}
      {data.length > 0 && (
        <div
          className="flex flex-wrap gap-3 animate-slide-up"
          style={{ animationDelay: '40ms' }}
          aria-live="polite"
        >
          {/* Total */}
          <div className="flex items-center gap-2 rounded-xl bg-card border px-4 py-2.5 elevation-1">
            <Activity className="size-4 text-md-primary" aria-hidden="true" />
            <span className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('statTotal')}</span>
            <span className="font-display text-base font-700 text-foreground">{data.length}</span>
          </div>
          {/* Online */}
          <div className="flex items-center gap-2 rounded-xl bg-md-tertiary-container border-0 px-4 py-2.5">
            <Wifi className="size-4 text-md-tertiary" aria-hidden="true" />
            <span className="text-xs font-500 text-md-on-tertiary-container uppercase tracking-wide">{t('statOnline')}</span>
            <span className="font-display text-base font-700 text-md-on-tertiary-container">{onlineCount}</span>
          </div>
          {/* Offline — always rendered to avoid toolbar layout shift; zero-state is muted */}
          <div
            className={[
              'flex items-center gap-2 rounded-xl border-0 px-4 py-2.5',
              offlineCount > 0 ? 'bg-md-error-container' : 'bg-muted',
            ].join(' ')}
          >
            <WifiOff
              className={`size-4 ${offlineCount > 0 ? 'text-md-error' : 'text-muted-foreground'}`}
              aria-hidden="true"
            />
            <span className={`text-xs font-500 uppercase tracking-wide ${offlineCount > 0 ? 'text-md-on-error-container' : 'text-muted-foreground'}`}>{t('statOffline')}</span>
            <span className={`font-display text-base font-700 ${offlineCount > 0 ? 'text-md-on-error-container' : 'text-muted-foreground'}`}>{offlineCount}</span>
          </div>
        </div>
      )}

      {/* ── Toolbar: filter radiogroup + last-updated + refresh ── */}
      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 animate-slide-up"
        style={{ animationDelay: '80ms' }}
      >
        {/* Filter segmented control (ARIA radiogroup + roving tabindex) */}
        <div
          role="radiogroup"
          aria-label={t('filterLabel')}
          className="flex rounded-xl border bg-card isolate text-sm"
        >
          {filters.map((f, idx) => {
            const selected = filter === f;
            const count = f === 'online' ? onlineCount : f === 'offline' ? offlineCount : data.length;
            return (
              <button
                type="button"
                key={f}
                ref={(el) => { filterRefs.current[idx] = el; }}
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setFilter(f)}
                onKeyDown={(e) => onFilterKeyDown(e, idx)}
                className={[
                  'state-layer min-h-12 px-4 text-sm font-500 transition-colors first:rounded-l-xl last:rounded-r-xl',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-inset',
                  selected
                    ? 'bg-md-secondary-container text-md-on-secondary-container'
                    : 'text-muted-foreground',
                ].join(' ')}
              >
                <span>
                  {t(`filter${f.charAt(0).toUpperCase() + f.slice(1)}`)}
                  {f !== 'all' && ` (${count})`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span
              className={[
                'inline-flex items-center gap-1.5 text-xs',
                isStale ? 'text-[hsl(38_92%_42%)] dark:text-[hsl(43_96%_62%)]' : 'text-muted-foreground',
              ].join(' ')}
              aria-live="polite"
            >
              {refreshing && (
                <span
                  className="inline-block size-3 rounded-full border-2 border-md-primary-container border-t-md-primary animate-spin"
                  aria-hidden="true"
                />
              )}
              {isStale && <span className="size-1.5 rounded-full bg-[hsl(43_96%_50%)] shrink-0" aria-hidden="true" />}
              {isStale ? t('staleUpdated', { time: updatedLabel }) : updatedLabel}
            </span>
          )}
          <Button
            variant="outline"
            onClick={() => load({ silent: data.length > 0 })}
            loading={loading || refreshing}
            aria-label={tCommon('refresh')}
            className="min-h-12 gap-1.5 text-sm font-500"
          >
            <RefreshCw className={`h-4 w-4 ${(loading || refreshing) ? 'animate-spin' : ''}`} aria-hidden="true" />
            {tCommon('refresh')}
          </Button>
        </div>
      </div>

      {/* ── Error banner (assertive, dismissible, with retry) ── */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl bg-md-error-container px-4 py-3 text-sm text-md-on-error-container animate-slide-up"
        >
          <span className="size-1.5 rounded-full bg-md-error shrink-0 mt-1.5" aria-hidden="true" />
          <span className="flex-1 break-words">{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => load({ silent: data.length > 0 })}
            className="shrink-0 -my-1 text-md-on-error-container hover:text-md-on-error-container"
          >
            {tCommon('reset')}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setError('')}
            aria-label={tCommon('clear')}
            className="shrink-0 -my-1 -mr-1 text-md-on-error-container"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {/* ── Table card ── */}
      <Card
        className="rounded-xl border overflow-hidden animate-slide-up"
        style={{ animationDelay: '120ms' }}
      >
        <CardContent className="p-0">
          <Table aria-label={t('title')} aria-busy={loading || refreshing}>
            <TableHeader>
              <TableRow className="bg-md-surface-container-high border-b border-md-outline-variant hover:bg-md-surface-container-high">
                <SortableHead label={t('colHostname')} sortKey="hostname" sort={sort} onSort={onSort} sortByLabel={t('sortBy', { col: t('colHostname') })} />
                <TableHead className="text-xs font-600 text-muted-foreground uppercase tracking-wide py-3">
                  {t('colLocation')}
                </TableHead>
                <SortableHead label={t('colStatus')} sortKey="status" sort={sort} onSort={onSort} sortByLabel={t('sortBy', { col: t('colStatus') })} />
                <SortableHead label={t('colCpu')} sortKey="cpu" sort={sort} onSort={onSort} sortByLabel={t('sortBy', { col: t('colCpu') })} align="right" />
                <SortableHead label={t('colMem')} sortKey="mem" sort={sort} onSort={onSort} sortByLabel={t('sortBy', { col: t('colMem') })} align="right" />
                <SortableHead label={t('colDisk')} sortKey="disk" sort={sort} onSort={onSort} sortByLabel={t('sortBy', { col: t('colDisk') })} align="right" />
                <SortableHead label={t('colUptime')} sortKey="uptime" sort={sort} onSort={onSort} sortByLabel={t('sortBy', { col: t('colUptime') })} responsive="hidden md:table-cell" />
                <SortableHead label={t('colLatency')} sortKey="latency" sort={sort} onSort={onSort} sortByLabel={t('sortBy', { col: t('colLatency') })} align="right" responsive="hidden sm:table-cell" />
                <SortableHead label={t('colCheckedAt')} sortKey="checkedAt" sort={sort} onSort={onSort} sortByLabel={t('sortBy', { col: t('colCheckedAt') })} responsive="hidden lg:table-cell" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="py-16 text-center">
                    <div className="inline-flex flex-col items-center gap-3" role="status" aria-label={tCommon('loading')}>
                      <span
                        className="inline-block size-8 rounded-full border-2 border-md-primary-container border-t-md-primary animate-spin"
                        aria-hidden="true"
                      />
                      <span className="text-sm text-muted-foreground">{tCommon('loading')}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="py-16 text-center">
                    <div className="inline-flex flex-col items-center gap-2" role="status" aria-live="polite">
                      <Activity className="size-8 text-md-outline" aria-hidden="true" />
                      <span className="text-sm text-muted-foreground">
                        {filter === 'all' ? t('noData') : t('noFilterMatch')}
                      </span>
                      {filter !== 'all' && (
                        <Button variant="link" size="sm" onClick={() => setFilter('all')}>
                          {t('clearFilter')}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((n, i) => (
                  <TableRow
                    key={n.mac ?? n.hostname}
                    className="border-b border-md-outline-variant/50 animate-slide-up hover:bg-transparent"
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
                      <PctBar v={n.cpu_pct} sevText={sevText(n.cpu_pct)} />
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      <PctBar v={n.mem_pct} sevText={sevText(n.mem_pct)} />
                    </TableCell>
                    <TableCell className="py-3 text-right">
                      <PctBar v={n.disk_pct} sevText={sevText(n.disk_pct)} />
                    </TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground hidden md:table-cell">
                      {formatUptime(n.uptime_sec)}
                    </TableCell>
                    <TableCell className="py-3 text-right text-xs tabular-nums text-muted-foreground hidden sm:table-cell">
                      {n.latency_ms != null ? (
                        <span className={n.latency_ms > LATENCY_WARNING_MS ? 'text-[hsl(38_92%_42%)] dark:text-[hsl(43_96%_62%)]' : 'text-foreground'}>
                          {n.latency_ms}ms
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-muted-foreground hidden lg:table-cell">
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

  // Translated severity word for PctBar accessible labels.
  function sevText(v: number | null | undefined): string {
    if (v == null) return '';
    if (v >= CPU_CRIT) return t('loadCritical');
    if (v >= CPU_WARN) return t('loadWarning');
    return '';
  }
}
