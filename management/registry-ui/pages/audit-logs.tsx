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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RefreshCw, Search, ClipboardList, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

const PAGE_SIZE = 50;

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
  const { user: currentUser, loading: authLoading } = useCurrentUser();
  const [logs, setLogs] = useState<model_AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  // 筛选状态
  const [filterAction, setFilterAction] = useState('');
  const [filterUsername, setFilterUsername] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

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
        limit: PAGE_SIZE,
        offset: p * PAGE_SIZE,
        action: filterAction || undefined,
        username: filterUsername || undefined,
        from: filterFrom || undefined,
        to: filterTo || undefined,
      })) ?? [];
      setLogs(data);
      setHasMore(data.length === PAGE_SIZE);
    } catch (e) {
      setError(getErrorMessage(e, tCommon('loading')));
    } finally {
      setLoading(false);
    }
  }, [filterAction, filterUsername, filterFrom, filterTo, tCommon]);

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

  if (authLoading) return null;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-md-primary-container text-md-on-primary-container">
            <ClipboardList className="size-5" />
          </div>
          <h1 className="font-display text-2xl font-600 text-foreground tracking-tight">
            {tNav('auditLogs')}
          </h1>
        </div>
        <button
          className="state-layer ripple inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-500 text-foreground transition-shadow hover:elevation-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
          onClick={() => loadLogs(page)}
          disabled={loading}
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          <span>{tCommon('refresh')}</span>
        </button>
      </div>

      {/* ── Filter bar ── */}
      <Card className="rounded-xl border bg-card animate-slide-up">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('auditAction')}
              </label>
              <select
                className="h-9 rounded-lg border border-input bg-md-surface-container-high px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-md-primary focus:ring-offset-0 focus:border-transparent transition-colors"
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
              >
                <option value="">{tCommon('all')}</option>
                {AUDIT_ACTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('auditUser')}
              </label>
              <Input
                className="h-9 w-36 rounded-lg bg-md-surface-container-high"
                placeholder={t('auditUser')}
                value={filterUsername}
                onChange={(e) => setFilterUsername(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('filterFrom')}
              </label>
              <Input
                type="datetime-local"
                className="h-9 rounded-lg bg-md-surface-container-high"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">
                {t('filterTo')}
              </label>
              <Input
                type="datetime-local"
                className="h-9 rounded-lg bg-md-surface-container-high"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
              />
            </div>
            <button
              className="state-layer ripple inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-500 bg-md-primary text-md-on-primary elevation-1 transition-shadow hover:elevation-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
              onClick={handleFilter}
              disabled={loading}
            >
              <Search className="size-4" />
              <span>{tCommon('search')}</span>
            </button>
            <button
              className="state-layer inline-flex items-center rounded-lg px-4 py-2 text-sm font-500 text-muted-foreground hover:bg-md-surface-container-high transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
              onClick={handleReset}
              disabled={loading}
            >
              <span>{tCommon('reset')}</span>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-md-error-container bg-md-error-container px-4 py-3 text-sm text-md-on-error-container animate-slide-up">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Data table ── */}
      <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '40ms' }}>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border">
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('auditTime')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('auditUser')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('auditAction')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('auditDetail')}</TableHead>
                <TableHead className="text-xs font-500 text-muted-foreground uppercase tracking-wide px-4 py-3">{t('auditIp')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-4">
                      {/* M3 circular progress indicator */}
                      <div
                        className="size-10 rounded-full border-4 border-md-primary-container border-t-md-primary animate-spin"
                        style={{ animationDuration: '0.9s', animationTimingFunction: 'linear' }}
                        aria-label={tCommon('loading')}
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
                        <ClipboardList className="size-7" />
                      </div>
                      <p className="text-sm text-muted-foreground">{tCommon('noData')}</p>
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
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground max-w-xs truncate">
                      {l.detail || <span className="text-xs italic opacity-60">{tCommon('noData')}</span>}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-xs text-muted-foreground font-mono">
                      {l.ip || <span className="italic opacity-60">{tCommon('noData')}</span>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Pagination ── */}
      <div className="flex items-center justify-end gap-2 animate-slide-up" style={{ animationDelay: '80ms' }}>
        <button
          className="state-layer inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-500 text-foreground transition-shadow hover:elevation-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 disabled:opacity-40 disabled:pointer-events-none"
          onClick={prevPage}
          disabled={page === 0 || loading}
        >
          <ChevronLeft className="size-4" />
          <span>{t('prevPage')}</span>
        </button>
        <span className="flex size-9 items-center justify-center rounded-lg bg-md-primary-container text-sm font-display font-600 text-md-on-primary-container">
          {page + 1}
        </span>
        <button
          className="state-layer inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-500 text-foreground transition-shadow hover:elevation-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 disabled:opacity-40 disabled:pointer-events-none"
          onClick={nextPage}
          disabled={!hasMore || loading}
        >
          <span>{t('nextPage')}</span>
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
