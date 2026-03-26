import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import type { main_AuditLog } from '@/src/generated/client';
import { AdminService } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
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
import { RefreshCw, Search } from 'lucide-react';
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
  const [logs, setLogs] = useState<main_AuditLog[]>([]);
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
    } catch (e: any) {
      setError(e?.message || tCommon('loading'));
    } finally {
      setLoading(false);
    }
  }, [filterAction, filterUsername, filterFrom, filterTo, tCommon]);

  useEffect(() => {
    if (!authLoading && currentUser?.can('audit:read')) {
      loadLogs(page);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{tNav('auditLogs')}</h1>
        <Button variant="outline" size="sm" onClick={() => loadLogs(page)} disabled={loading}>
          <RefreshCw className="mr-1 h-4 w-4" />
          {tCommon('refresh')}
        </Button>
      </div>

      {/* 筛选栏 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('auditAction')}</label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
              >
                <option value="">{tCommon('all')}</option>
                {AUDIT_ACTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('auditUser')}</label>
              <Input
                className="h-9 w-32"
                placeholder={t('auditUser')}
                value={filterUsername}
                onChange={(e) => setFilterUsername(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('filterFrom')}</label>
              <Input
                type="datetime-local"
                className="h-9"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t('filterTo')}</label>
              <Input
                type="datetime-local"
                className="h-9"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={handleFilter} disabled={loading}>
              <Search className="mr-1 h-4 w-4" />
              {tCommon('search')}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleReset} disabled={loading}>
              {tCommon('reset')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('auditTime')}</TableHead>
                <TableHead>{t('auditUser')}</TableHead>
                <TableHead>{t('auditAction')}</TableHead>
                <TableHead>{t('auditDetail')}</TableHead>
                <TableHead>{t('auditIp')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {tCommon('loading')}
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {tCommon('noData')}
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                      {formatDate(l.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">{l.username}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1 py-0.5 text-xs">{l.action}</code>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{l.detail || tCommon('noData')}</TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono">{l.ip || tCommon('noData')}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={prevPage} disabled={page === 0 || loading}>
          {t('prevPage')}
        </Button>
        <span className="text-sm text-muted-foreground">{page + 1}</span>
        <Button variant="outline" size="sm" onClick={nextPage} disabled={!hasMore || loading}>
          {t('nextPage')}
        </Button>
      </div>
    </div>
  );
}
