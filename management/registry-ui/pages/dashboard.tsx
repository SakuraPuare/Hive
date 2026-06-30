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

// M3 token recipes per card variant — no raw palette colors
type CardVariant = 'total' | 'online' | 'offline' | 'new';
const CARD_VARIANT_STYLES: Record<CardVariant, { iconBg: string; iconColor: string }> = {
  total:   { iconBg: 'bg-md-primary-container',  iconColor: 'text-md-on-primary-container' },
  online:  { iconBg: 'bg-md-tertiary-container', iconColor: 'text-md-on-tertiary-container' },
  offline: { iconBg: 'bg-md-error-container',    iconColor: 'text-md-on-error-container' },
  new:     { iconBg: 'bg-md-secondary-container',iconColor: 'text-md-on-secondary-container' },
};

interface StatsCardProps {
  title: string;
  value: number;
  icon: React.ElementType;
  variant: CardVariant;
  delay?: number;
}

function StatsCard({ title, value, icon: Icon, variant, delay = 0 }: StatsCardProps) {
  const { iconBg, iconColor } = CARD_VARIANT_STYLES[variant];
  return (
    <Card
      className="animate-slide-up bg-card border rounded-xl"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="flex items-center gap-4 py-5">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className={`h-6 w-6 ${iconColor}`} />
        </div>
        <div>
          <p className="text-xs font-500 uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="font-display text-2xl font-700 text-foreground mt-0.5">{value}</p>
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

// §10 status color recipes — M3 token roles only, no raw palette
function getStatusBadge(probeStatus: string | undefined) {
  if (probeStatus === 'online')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-tertiary-container text-md-on-tertiary-container">
        <span className="size-1.5 rounded-full bg-md-tertiary" />Online
      </span>
    );
  if (probeStatus === 'offline')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-error-container text-md-on-error-container">
        <span className="size-1.5 rounded-full bg-md-error" />Offline
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-muted text-muted-foreground">
      <span className="size-1.5 rounded-full bg-md-outline" />Unknown
    </span>
  );
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
      {/* Page header */}
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-600 tracking-tight text-foreground">
          {tNav('dashboard')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('subtitle') || 'Node fleet overview'}</p>
      </div>

      {loading ? (
        /* M3 circular loading indicator */
        <div className="flex items-center justify-center py-24">
          <div
            className="h-10 w-10 rounded-full border-[3px] border-md-primary-container border-t-md-primary animate-spin"
            style={{ animationTimingFunction: 'var(--ease-standard)' }}
          />
        </div>
      ) : (
        <>
          {/* Stat cards — staggered entrance */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatsCard
              title={t('totalNodes')}
              value={nodes.length}
              icon={Server}
              variant="total"
              delay={0}
            />
            <StatsCard
              title={t('onlineNodes')}
              value={onlineCount}
              icon={Wifi}
              variant="online"
              delay={60}
            />
            <StatsCard
              title={t('offlineNodes')}
              value={offlineCount}
              icon={WifiOff}
              variant="offline"
              delay={120}
            />
            <StatsCard
              title={t('newThisWeek')}
              value={recentNodes.length}
              icon={CalendarPlus}
              variant="new"
              delay={180}
            />
          </div>

          {/* Online rate — tonal surface card, tertiary fill for success signal */}
          {nodes.length > 0 && (
            <Card
              className="bg-card border rounded-xl animate-slide-up"
              style={{ animationDelay: '220ms' }}
            >
              <CardContent className="py-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Activity className="h-4 w-4" />
                    <span className="text-sm font-500">{t('onlineRate') || 'Online Rate'}</span>
                  </div>
                  <span className="font-display text-sm font-600 text-md-tertiary">
                    {nodes.length > 0 ? ((onlineCount / nodes.length) * 100).toFixed(1) : 0}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-md-surface-container-high overflow-hidden">
                  <div
                    className="h-full rounded-full bg-md-tertiary transition-all duration-700"
                    style={{
                      width: `${nodes.length > 0 ? (onlineCount / nodes.length) * 100 : 0}%`,
                      transitionTimingFunction: 'var(--ease-emphasized)',
                    }}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recently registered nodes */}
          <Card
            className="bg-card border rounded-xl animate-slide-up"
            style={{ animationDelay: '260ms' }}
          >
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-base font-600 text-foreground">
                {t('recentlyRegistered')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentNodes.length === 0 ? (
                <div className="px-6 pb-8 pt-4 flex flex-col items-center gap-2 text-center">
                  <Server className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">{t('noNodesThisWeek')}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border">
                      <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                        {tNodes('colHostname')}
                      </TableHead>
                      <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                        {tNodes('colLocation')}
                      </TableHead>
                      <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                        {tNodes('colStatus') || 'Status'}
                      </TableHead>
                      <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                        {tNodes('colTailscaleIp')}
                      </TableHead>
                      <TableHead className="text-xs font-500 uppercase tracking-wide text-muted-foreground">
                        {tNodes('colRegisteredAt')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentNodes.map((n, i) => (
                      <TableRow
                        key={n.mac}
                        className="hover-state border-b border-border/60 last:border-0 animate-slide-up"
                        style={{ animationDelay: `${300 + i * 40}ms` }}
                      >
                        <TableCell className="font-500 text-foreground">
                          {n.hostname || tCommon('noData')}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Globe className="h-3.5 w-3.5" />
                            <span className="text-sm">{n.location || tCommon('noData')}</span>
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(n.probe_status)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {n.tailscale_ip || tCommon('noData')}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(n.registered_at, locale, tCommon('noData'))}
                        </TableCell>
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
