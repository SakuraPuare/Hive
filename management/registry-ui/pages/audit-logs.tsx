import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { main_AuditLog } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { useCurrentUser } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

const PAGE_SIZE = 50;

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

  useEffect(() => {
    if (!authLoading && currentUser && !currentUser.can('audit:read')) {
      router.replace('/dashboard');
    }
  }, [authLoading, currentUser, router]);

  async function loadLogs(p: number) {
    setLoading(true);
    setError('');
    try {
      const data = await sessionApi(
        AdminService.adminAuditLogs({ limit: PAGE_SIZE, offset: p * PAGE_SIZE }),
      );
      setLogs(data);
      setHasMore(data.length === PAGE_SIZE);
    } catch (e: any) {
      setError(e?.error || e?.message || tCommon('loading'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && currentUser?.can('audit:read')) {
      loadLogs(page);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, currentUser, page]);

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
