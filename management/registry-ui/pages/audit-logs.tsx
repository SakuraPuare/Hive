import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import type { model_AuditLog } from '@/src/generated/client';
import { AdminService } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { useCurrentUser } from '@/lib/auth';
import { useFormat } from '@/lib/format';
import { useClipboard } from '@/lib/use-clipboard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
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
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
  Check,
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

/** Map an audit action string to an M3 semantic badge style. */
function getActionVariant(action: string | undefined): string {
  if (!action) return 'bg-md-secondary-container text-md-on-secondary-container';
  if (action.endsWith('_fail') || action === 'logout')
    return 'bg-md-error-container text-md-on-error-container';
  if (action.endsWith('_success') || action === 'login_success')
    return 'bg-md-tertiary-container text-md-on-tertiary-container';
  return 'bg-md-secondary-container text-md-on-secondary-container';
}

/** Convert a datetime-local value (YYYY-MM-DDTHH:mm) to RFC 3339 UTC string. */
function toRfc3339(localDt: string): string {
  if (!localDt) return '';
  // new Date() parses the local datetime string in the browser's timezone,
  // then toISOString() serialises to UTC — correct for any UTC offset.
  return new Date(localDt).toISOString();
}

interface FilterState {
  action: string;
  username: string;
  from: string;
  to: string;
}

const EMPTY_FILTER: FilterState = { action: '', username: '', from: '', to: '' };

export default function AuditLogsPage() {
  const router = useRouter();
  const t = useTranslations('auditLogs');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const toast = useToast();
  const fmt = useFormat();
  const { user: currentUser, loading: authLoading } = useCurrentUser();

  const [logs, setLogs] = useState<model_AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [hasMore, setHasMore] = useState(true);

  // UI-bound (input) filter state — changes on every keystroke/selection.
  const [inputFilter, setInputFilter] = useState<FilterState>(EMPTY_FILTER);
  // Committed filter state — only changes when the user submits the filter form.
  // loadLogs depends on this, not on inputFilter, to prevent per-keystroke fetches.
  const [committedFilter, setCommittedFilter] = useState<FilterState>(EMPTY_FILTER);

  // Detail dialog state
  const [detailLog, setDetailLog] = useState<model_AuditLog | null>(null);
  const { copied: detailCopied, copy: copyDetail } = useClipboard();

  const hasActiveFilters = Boolean(
    committedFilter.action || committedFilter.username ||
    committedFilter.from || committedFilter.to
  );

  const dateRangeInvalid = Boolean(
    inputFilter.from && inputFilter.to && inputFilter.to < inputFilter.from
  );

  useEffect(() => {
    if (!authLoading && currentUser && !currentUser.can('audit:read')) {
      router.replace('/dashboard');
    }
  }, [authLoading, currentUser, router]);

  // loadLogs depends on committedFilter + pageSize, NOT on inputFilter.
  // This ensures API calls only fire when the user explicitly submits.
  const loadLogs = useCallback(async (p: number) => {
    setLoading(true);
    setError('');
    try {
      // Fetch one extra record to detect whether a next page exists (off-by-one fix).
      const data = await sessionApi(AdminService.adminAuditLogs({
        limit: pageSize + 1,
        offset: p * pageSize,
        action: committedFilter.action || undefined,
        username: committedFilter.username || undefined,
        from: committedFilter.from ? toRfc3339(committedFilter.from) : undefined,
        to: committedFilter.to ? toRfc3339(committedFilter.to) : undefined,
      })) ?? [];
      setHasMore(data.length > pageSize);
      setLogs(data.slice(0, pageSize));
    } catch (e) {
      setError(getErrorMessage(e, tCommon('loading')));
    } finally {
      setLoading(false);
    }
  }, [committedFilter.action, committedFilter.username, committedFilter.from, committedFilter.to, pageSize, tCommon]);

  useEffect(() => {
    if (!authLoading && currentUser?.can('audit:read')) {
      loadLogs(page);
    }
  }, [authLoading, currentUser, page, loadLogs]);

  function handleFilter() {
    // Guard: do not submit if date range is invalid.
    if (dateRangeInvalid) return;
    // Commit the input filter. This updates committedFilter, which is a dep of
    // loadLogs — the useEffect will fire a single fetch. Do NOT call loadLogs
    // directly here to avoid a double-fetch when page is already 0.
    setCommittedFilter({ ...inputFilter });
    setPage(0);
  }

  function handleReset() {
    setInputFilter(EMPTY_FILTER);
    setCommittedFilter(EMPTY_FILTER);
    setPage(0);
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
    <PageContainer>
      <PageHeader
        icon={<ClipboardList />}
        title={tNav('auditLogs')}
        actions={
          <Button
            variant="outline"
            onClick={() => loadLogs(page)}
            loading={loading}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            <span>{tCommon('refresh')}</span>
          </Button>
        }
      />

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
                value={inputFilter.action || ALL_ACTIONS}
                onValueChange={(v) =>
                  setInputFilter((f) => ({ ...f, action: v === ALL_ACTIONS ? '' : v }))
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
                value={inputFilter.username}
                onChange={(e) => setInputFilter((f) => ({ ...f, username: e.target.value }))}
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
                value={inputFilter.from}
                onChange={(e) => setInputFilter((f) => ({ ...f, from: e.target.value }))}
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
                error={dateRangeInvalid ? t('rangeInvalid') : undefined}
                value={inputFilter.to}
                onChange={(e) => setInputFilter((f) => ({ ...f, to: e.target.value }))}
              />
            </div>
            <Button
              type="submit"
              loading={loading}
              disabled={loading || dateRangeInvalid}
            >
              <Search className="size-4" aria-hidden="true" />
              <span>{tCommon('search')}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleReset}
              disabled={loading || (!hasActiveFilters && !inputFilter.action && !inputFilter.username && !inputFilter.from && !inputFilter.to)}
            >
              {tCommon('reset')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ── Active filter chips (based on committed filter) ── */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-500 text-muted-foreground">
            {t('activeFilters')}
          </span>
          {committedFilter.action && (
            <FilterChip
              label={`${t('auditAction')}: ${committedFilter.action}`}
              removeLabel={t('removeFilter')}
              onRemove={() => {
                setCommittedFilter((f) => ({ ...f, action: '' }));
                setInputFilter((f) => ({ ...f, action: '' }));
                setPage(0);
              }}
            />
          )}
          {committedFilter.username && (
            <FilterChip
              label={`${t('auditUser')}: ${committedFilter.username}`}
              removeLabel={t('removeFilter')}
              onRemove={() => {
                setCommittedFilter((f) => ({ ...f, username: '' }));
                setInputFilter((f) => ({ ...f, username: '' }));
                setPage(0);
              }}
            />
          )}
          {committedFilter.from && (
            <FilterChip
              label={`${t('filterFrom')}: ${fmt.dateTime(new Date(committedFilter.from))}`}
              removeLabel={t('removeFilter')}
              onRemove={() => {
                setCommittedFilter((f) => ({ ...f, from: '' }));
                setInputFilter((f) => ({ ...f, from: '' }));
                setPage(0);
              }}
            />
          )}
          {committedFilter.to && (
            <FilterChip
              label={`${t('filterTo')}: ${fmt.dateTime(new Date(committedFilter.to))}`}
              removeLabel={t('removeFilter')}
              onRemove={() => {
                setCommittedFilter((f) => ({ ...f, to: '' }));
                setInputFilter((f) => ({ ...f, to: '' }));
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
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>{fmt.relative(l.created_at)}</span>
                        </TooltipTrigger>
                        <TooltipContent>{fmt.dateTime(l.created_at)}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm font-500 text-foreground">
                      {l.username}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-500 font-mono ${getActionVariant(l.action)}`}
                      >
                        {l.action}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                      {l.detail ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="block max-w-xs truncate text-left font-normal"
                              onClick={() => setDetailLog(l)}
                            >
                              {l.detail}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-md break-words font-mono whitespace-pre-wrap">
                            {t('detailTooltipHint')}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-xs italic opacity-60">{tCommon('noData')}</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {l.ip ? (
                        <IpCopyButton ip={l.ip} copyLabel={t('copyIp')} />
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
            onClick={() => setPage((p) => Math.max(0, p - 1))}
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
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore || loading}
          >
            <span>{t('nextPage')}</span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* ── Detail dialog ── */}
      <Dialog open={detailLog !== null} onOpenChange={(open) => { if (!open) setDetailLog(null); }}>
        <DialogContent size="xl" closeLabel={tCommon('close')}>
          <DialogHeader>
            <DialogTitle>{t('detailDialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto rounded-lg bg-md-surface-container p-4">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground select-text">
              {(() => {
                if (!detailLog?.detail) return '';
                try {
                  return JSON.stringify(JSON.parse(detailLog.detail), null, 2);
                } catch {
                  return detailLog.detail;
                }
              })()}
            </pre>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (!detailLog?.detail) return;
                const ok = await copyDetail(detailLog.detail);
                if (ok) toast.success(t('detailCopied'));
                else toast.error(t('ipCopyFailed'));
              }}
            >
              {detailCopied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              <span>{detailCopied ? tCommon('copied') : tCommon('copy')}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
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

/** Per-row IP copy button — owns its own `copied` state so rows don't bleed. */
function IpCopyButton({ ip, copyLabel }: { ip: string; copyLabel: string }) {
  const { copied, copy } = useClipboard();
  const toast = useToast();
  const t = useTranslations('auditLogs');

  async function handleCopy() {
    const ok = await copy(ip);
    if (ok) toast.success(t('ipCopied'));
    else toast.error(t('ipCopyFailed'));
  }

  return (
    <span className="group inline-flex items-center gap-1.5">
      <span>{ip}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={copyLabel}
            onClick={handleCopy}
          >
            {copied ? (
              <Check className="size-3" aria-hidden="true" />
            ) : (
              <Copy className="size-3" aria-hidden="true" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copyLabel}</TooltipContent>
      </Tooltip>
    </span>
  );
}
