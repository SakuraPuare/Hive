import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import type { model_AuditLog } from '@/src/generated/client';
import { AdminService } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  RefreshCw,
  Search,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  X,
  Copy,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;
const ALL_ACTIONS = '__all__';

const AUDIT_ACTIONS = [
  'login_success', 'login_fail', 'logout',
  'user_create', 'user_delete', 'password_change', 'user_roles_update',
  'node_register', 'node_update', 'node_delete',
  'subscription_group_create', 'subscription_group_delete',
  'subscription_group_set_nodes', 'subscription_group_reset_token',
  'role_perm_update',
];

function formatDate(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'medium' });
}

export default function AuditLogsPage() {
  const router = useRouter();
  const t = useTranslations('auditLogs');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const toast = useToast();
  const { user: currentUser, loading: authLoading } = useCurrentUser();
  const [logs, setLogs] = useState<model_AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);

  // 筛选状态
  const [filterAction, setFilterAction] = useState('');
  const [filterUsername, setFilterUsername] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const hasActiveFilters = Boolean(
    filterAction || filterUsername || filterFrom || filterTo
  );

  useEffect(() => {
    if (!authLoading && currentUser && !currentUser.can('audit:read')) {
      router.replace('/dashboard');
    }
  }, [authLoading, currentUser, router]);

  const loadLogs = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await sessionApi(AdminService.adminAuditLogs({
        limit: pageSize,
        offset: p * pageSize,
        action: filterAction || undefined,
        username: filterUsername || undefined,
        from: filterFrom || undefined,
        to: filterTo || undefined,
      })) ?? [];
      setLogs(data);
      setHasMore(data.length >= pageSize);
    } catch (e) {
      setError(getErrorMessage(e, tCommon('loading')));
    } finally {
      setLoading(false);
    }
  }, [filterAction, filterUsername, filterFrom, filterTo, pageSize, tCommon]);

  useEffect(() => {
    if (!authLoading && currentUser?.can('audit:read')) {
      loadLogs(page);
    }
  }, [authLoading, currentUser, page, loadLogs]);

  function handleFilter() {
    setPage(0);
    loadLogs(0);
  }

  function handleReset() {
    setFilterAction('');
    setFilterUsername('');
    setFilterFrom('');
    setFilterTo('');
    setPage(0);
  }

  function prevPage() {
    const p = Math.max(0, page - 1);
    setPage(p);
  }

  function nextPage() {
    setPage(page + 1);
  }

  async function copyIp(ip: string) {
    try {
      await navigator.clipboard.writeText(ip);
      toast.success(t('ipCopied'));
    } catch {
      toast.error(t('ipCopyFailed'));
    }
  }

  if (authLoading) {
    return (
      <div
        className="flex min-h-[40vh] flex-col items-center justify-center gap-3"
        role="status"
        aria-live="polite"
      >
        <div
          className="size-8 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin"
          aria-hidden="true"
        />
        <span className="sr-only">{t('verifyingIdentity')}</span>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6 animate-fade-in">
        {/* ── Page header ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-md-primary-container text-md-on-primary-container">
              <ClipboardList className="size-5" aria-hidden="true" />
            </div>
            <h1 className="font-display text-2xl font-600 text-foreground tracking-tight">
              {tNav('auditLogs')}
            </h1>
          </div>
          <Button
            variant="outline"
            onClick={() => loadLogs(page)}
            loading={loading}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>{tCommon('refresh')}</span>
          </Button>
        </div>

        {/* ── Filter bar ── */}
        <Card className="rounded-xl border bg-card animate-slide-up">
          <CardContent className="p-5">
            <form
              className="flex flex-wrap items-end gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                handleFilter();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <label
                  id="filter-action-label"
                  htmlFor="filter-action"
                  className="text-xs font-500 text-muted-foreground uppercase tracking-wide"
                >
                  {t('auditAction')}
                </label>
                <Select
                  value={filterAction || ALL_ACTIONS}
                  onValueChange={(v) =>
                    setFilterAction(v === ALL_ACTIONS ? '' : v)
                  }
                >
                  <SelectTrigger
                    id="filter-action"
                    aria-labelledby="filter-action-label"
                    className="w-44"
                  >
                    <SelectValue placeholder={tCommon('all')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_ACTIONS}>{tCommon('all')}</SelectItem>
                    {AUDIT_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="filter-username"
                  className="text-xs font-500 text-muted-foreground uppercase tracking-wide"
                >
                  {t('auditUser')}
                </label>
                <Input
                  id="filter-username"
                  size="sm"
                  className="w-40"
                  placeholder={t('auditUser')}
                  value={filterUsername}
                  onChange={(e) => setFilterUsername(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="filter-from"
                  className="text-xs font-500 text-muted-foreground uppercase tracking-wide"
                >
                  {t('filterFrom')}
                </label>
                <Input
                  id="filter-from"
                  type="datetime-local"
                  size="sm"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="filter-to"
                  className="text-xs font-500 text-muted-foreground uppercase tracking-wide"
                >
                  {t('filterTo')}
                </label>
                <Input
                  id="filter-to"
                  type="datetime-local"
                  size="sm"
                  error={
                    filterFrom && filterTo && filterTo < filterFrom
                      ? t('rangeInvalid')
                      : undefined
                  }
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                />
              </div>
              <Button type="submit" loading={loading}>
                <Search className="size-4" aria-hidden="true" />
                <span>{tCommon('search')}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleReset}
                disabled={loading || !hasActiveFilters}
              >
                {tCommon('reset')}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ── Active filter chips ── */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-500 text-muted-foreground">
              {t('activeFilters')}
            </span>
            {filterAction && (
              <FilterChip
                label={`${t('auditAction')}: ${filterAction}`}
                removeLabel={t('removeFilter')}
                onRemove={() => {
                  setFilterAction('');
                  setPage(0);
                }}
              />
            )}
            {filterUsername && (
              <FilterChip
                label={`${t('auditUser')}: ${filterUsername}`}
                removeLabel={t('removeFilter')}
                onRemove={() => {
                  setFilterUsername('');
                  setPage(0);
                }}
              />
            )}
            {filterFrom && (
              <FilterChip
                label={`${t('filterFrom')}: ${filterFrom}`}
                removeLabel={t('removeFilter')}
                onRemove={() => {
                  setFilterFrom('');
                  setPage(0);
                }}
              />
            )}
            {filterTo && (
              <FilterChip
                label={`${t('filterTo')}: ${filterTo}`}
                removeLabel={t('removeFilter')}
                onRemove={() => {
                  setFilterTo('');
                  setPage(0);
                }}
              />
            )}
          </div>
        )}

        {/* ── Error banner ── */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-center gap-3 rounded-xl border border-md-error-container bg-md-error-container px-4 py-3 text-sm text-md-on-error-container animate-slide-up"
          >
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{error}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-md-on-error-container hover:bg-md-on-error-container/10"
              onClick={() => loadLogs(page)}
            >
              {t('retry')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-md-on-error-container hover:bg-md-on-error-container/10"
              aria-label={t('dismissError')}
              onClick={() => setError('')}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}

        {/* ── Data table ── */}
        <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '40ms' }}>
          <CardContent className="p-0">
            <Table aria-label={tNav('auditLogs')} aria-busy={loading}>
              <TableHeader>
                <TableRow className="border-b border-border">
                  <TableHead scope="col" className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('auditTime')}</TableHead>
                  <TableHead scope="col" className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('auditUser')}</TableHead>
                  <TableHead scope="col" className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('auditAction')}</TableHead>
                  <TableHead scope="col" className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('auditDetail')}</TableHead>
                  <TableHead scope="col" className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('auditIp')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
                        {/* M3 circular progress indicator */}
                        <div
                          className="size-10 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin"
                          style={{ animationDuration: '0.9s', animationTimingFunction: 'linear' }}
                          aria-hidden="true"
                        />
                        <span className="text-sm text-muted-foreground">{tCommon('loading')}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-3 animate-fade-in">
                        <div className="flex size-14 items-center justify-center rounded-2xl bg-md-surface-container-high text-muted-foreground">
                          <ClipboardList className="size-7" aria-hidden="true" />
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {hasActiveFilters ? t('filterNoResults') : tCommon('noData')}
                        </p>
                        {hasActiveFilters && (
                          <Button type="button" variant="ghost" size="sm" onClick={handleReset}>
                            {t('clearFilters')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((l, i) => (
                    <TableRow
                      key={l.id}
                      className="hover-state border-b border-border/60 last:border-b-0 animate-slide-up"
                      style={{ animationDelay: `${i * 20}ms` }}
                    >
                      <TableCell className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground font-mono">
                        {formatDate(l.created_at ?? '')}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-sm font-500 text-foreground">
                        {l.username}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-md-primary-container px-2.5 py-0.5 text-xs font-500 text-md-on-primary-container font-mono">
                          {l.action}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                        {l.detail ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="block max-w-xs truncate text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 rounded-sm"
                              >
                                {l.detail}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-md break-words font-mono whitespace-pre-wrap">
                              {l.detail}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-xs italic opacity-60">{tCommon('noData')}</span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {l.ip ? (
                          <span className="group inline-flex items-center gap-1.5">
                            <span>{l.ip}</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                  aria-label={t('copyIp')}
                                  onClick={() => copyIp(l.ip ?? '')}
                                >
                                  <Copy className="size-3" aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('copyIp')}</TooltipContent>
                            </Tooltip>
                          </span>
                        ) : (
                          <span className="italic opacity-60">{tCommon('noData')}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ── Pagination ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 animate-slide-up" style={{ animationDelay: '80ms' }}>
          <div className="flex items-center gap-2">
            <label
              id="page-size-label"
              htmlFor="page-size"
              className="text-xs font-500 text-muted-foreground"
            >
              {t('pageSize')}
            </label>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(0);
              }}
            >
              <SelectTrigger
                id="page-size"
                size="sm"
                aria-labelledby="page-size-label"
                className="w-20"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={prevPage}
              disabled={page === 0 || loading}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              <span>{t('prevPage')}</span>
            </Button>
            <span
              className="flex size-9 items-center justify-center rounded-lg bg-md-primary-container text-sm font-display font-600 text-md-on-primary-container"
              aria-label={t('pageIndicator', { page: page + 1 })}
            >
              <span aria-hidden="true">{page + 1}</span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={nextPage}
              disabled={!hasMore || loading}
            >
              <span>{t('nextPage')}</span>
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function FilterChip({
  label,
  removeLabel,
  onRemove,
}: {
  label: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-md-surface-container-high py-1 pl-3 pr-1 text-xs font-500 text-foreground">
      <span>{label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        aria-label={`${removeLabel}: ${label}`}
        onClick={onRemove}
      >
        <X className="size-3" aria-hidden="true" />
      </Button>
    </span>
  );
}
