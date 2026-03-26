import React, { useEffect, useMemo, useState } from 'react';
import { NodesService } from '@/src/generated/client';
import type { main_Node } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Server, Network, Globe, CalendarPlus, Wifi, WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/locale';

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

function formatDate(s: string | undefined | null, locale: string, noData: string) {
  if (!s) return noData;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function Dashboard() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const tNodes = useTranslations('nodes');
  const { locale } = useLocale();
  const [nodes, setNodes] = useState<main_Node[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sessionApi(NodesService.nodesList())
      .then(setNodes)
      .finally(() => setLoading(false));
  }, []);

  const onlineCount = useMemo(
    () => nodes.filter((n) => (n as any).probe_status === 'online').length,
    [nodes]
  );
  const offlineCount = useMemo(
    () => nodes.filter((n) => (n as any).probe_status === 'offline').length,
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
      <h1 className="text-2xl font-bold tracking-tight">{tNav('dashboard')}</h1>

      {loading ? (
        <p className="text-muted-foreground">{tCommon('loading')}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatsCard title={t('totalNodes')} value={nodes.length} icon={Server} />
            <StatsCard title={t('onlineNodes')} value={onlineCount} icon={Wifi} />
            <StatsCard title={t('offlineNodes')} value={offlineCount} icon={WifiOff} />
            <StatsCard title={t('newThisWeek')} value={recentNodes.length} icon={CalendarPlus} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('recentlyRegistered')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentNodes.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">{t('noNodesThisWeek')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tNodes('colHostname')}</TableHead>
                      <TableHead>{tNodes('colLocation')}</TableHead>
                      <TableHead>{tNodes('colTailscaleIp')}</TableHead>
                      <TableHead>{tNodes('colRegisteredAt')}</TableHead>
                      <TableHead>{tNodes('colMac')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentNodes.map((n) => (
                      <TableRow key={n.mac}>
                        <TableCell className="font-medium">{n.hostname || tCommon('noData')}</TableCell>
                        <TableCell>{n.location || tCommon('noData')}</TableCell>
                        <TableCell className="font-mono text-xs">{n.tailscale_ip || tCommon('noData')}</TableCell>
                        <TableCell>{formatDate(n.registered_at, locale, tCommon('noData'))}</TableCell>
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
