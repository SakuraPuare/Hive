import React, { useEffect, useMemo, useState } from 'react';
import { AdminService } from '@/src/generated/client';
import type { model_Node } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Server, Wifi, WifiOff, CalendarPlus, Globe, Activity } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/locale';

interface StatsCardProps {
  title: string;
  value: number;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}

function StatsCard({ title, value, icon: Icon, color, bgColor }: StatsCardProps) {
  return (
    <Card className="animate-slide-up">
      <CardContent className="flex items-center gap-4 py-5">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${bgColor}`}>
          <Icon className={`h-6 w-6 ${color}`} />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
        </div>
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

function getStatusBadge(probeStatus: string | undefined) {
  if (probeStatus === 'online')
    return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0 gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Online</Badge>;
  if (probeStatus === 'offline')
    return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border-0 gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />Offline</Badge>;
  return <Badge variant="outline" className="text-muted-foreground gap-1"><span className="h-1.5 w-1.5 rounded-full bg-gray-400" />Unknown</Badge>;
}

export default function Dashboard() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const tNodes = useTranslations('nodes');
  const { locale } = useLocale();
  const [nodes, setNodes] = useState<model_Node[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sessionApi(AdminService.nodesList({}))
      .then(setNodes)
      .finally(() => setLoading(false));
  }, []);

  const onlineCount = useMemo(
    () => nodes.filter((n) => n.probe_status === 'online').length,
    [nodes]
  );
  const offlineCount = useMemo(
    () => nodes.filter((n) => n.probe_status === 'offline').length,
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
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{tNav('dashboard')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle') || 'Node fleet overview'}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatsCard
              title={t('totalNodes')}
              value={nodes.length}
              icon={Server}
              color="text-blue-600 dark:text-blue-400"
              bgColor="bg-blue-500/10"
            />
            <StatsCard
              title={t('onlineNodes')}
              value={onlineCount}
              icon={Wifi}
              color="text-emerald-600 dark:text-emerald-400"
              bgColor="bg-emerald-500/10"
            />
            <StatsCard
              title={t('offlineNodes')}
              value={offlineCount}
              icon={WifiOff}
              color="text-red-600 dark:text-red-400"
              bgColor="bg-red-500/10"
            />
            <StatsCard
              title={t('newThisWeek')}
              value={recentNodes.length}
              icon={CalendarPlus}
              color="text-purple-600 dark:text-purple-400"
              bgColor="bg-purple-500/10"
            />
          </div>

          {/* Online rate bar */}
          {nodes.length > 0 && (
            <Card>
              <CardContent className="py-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{t('onlineRate') || 'Online Rate'}</span>
                  </div>
                  <span className="text-sm font-bold text-primary">
                    {nodes.length > 0 ? ((onlineCount / nodes.length) * 100).toFixed(1) : 0}%
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-700"
                    style={{ width: `${nodes.length > 0 ? (onlineCount / nodes.length) * 100 : 0}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('recentlyRegistered')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentNodes.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">{t('noNodesThisWeek')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tNodes('colHostname')}</TableHead>
                      <TableHead>{tNodes('colLocation')}</TableHead>
                      <TableHead>{tNodes('colStatus') || 'Status'}</TableHead>
                      <TableHead>{tNodes('colTailscaleIp')}</TableHead>
                      <TableHead>{tNodes('colRegisteredAt')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentNodes.map((n) => (
                      <TableRow key={n.mac}>
                        <TableCell className="font-medium">{n.hostname || tCommon('noData')}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                            {n.location || tCommon('noData')}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(n.probe_status)}</TableCell>
                        <TableCell className="font-mono text-xs">{n.tailscale_ip || tCommon('noData')}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(n.registered_at, locale, tCommon('noData'))}</TableCell>
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
