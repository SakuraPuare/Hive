import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Node } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Server, Wifi, WifiOff, CalendarPlus, Globe, Activity, AlertTriangle, Info } from 'lucide-react';
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
          <Icon aria-hidden="true" className={`h-6 w-6 ${iconColor}`} />
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
function getStatusBadge(probeStatus: string | undefined, label: string) {
  if (probeStatus === 'online')
    return (
      <span
        role="status"
        aria-label={label}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-tertiary-container text-md-on-tertiary-container"
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-md-tertiary" />Online
      </span>
    );
  if (probeStatus === 'offline')
    return (
      <span
        role="status"
        aria-label={label}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-md-error-container text-md-on-error-container"
      >
        <span aria-hidden="true" className="size-1.5 rounded-full bg-md-error" />Offline
      </span>
    );
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 bg-muted text-muted-foreground"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-md-outline" />Unknown
    </span>
  );
}

export default function Dashboard() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const tNodes = useTranslations('nodes');
  const { locale } = useLocale();
  const router = useRouter();
  const [nodes, setNodes] = useState<model_Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const loadNodes = useCallback(() => {
    setLoading(true);
    setError(null);
    sessionApi(AdminService.nodesList({}))
      .then((res) => setNodes(res ?? []))
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadNodes();
  }, [loadNodes]);

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

  const onlinePct = nodes.length > 0 ? (onlineCount / nodes.length) * 100 : 0;
  // Threshold encoding (information, not decoration): <60% critical, otherwise healthy
  const isLowHealth = nodes.length > 0 && onlinePct < 60;
  const onlineFillClass = isLowHealth ? 'bg-md-error' : 'bg-md-tertiary';
  const onlinePctTextClass = isLowHealth ? 'text-md-error' : 'text-md-tertiary';

  return (
    <TooltipProvider>
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-3xl font-600 tracking-tight text-foreground">
            {tNav('dashboard')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('subtitle') || 'Node fleet overview'}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadNodes}
          loading={loading}
          aria-label={tCommon('refresh')}
        >
          {tCommon('refresh')}
        </Button>
      </div>

      {loading ? (
        /* Skeleton matching final layout to avoid CLS */
        <div role="status" aria-label={t('loadingNodes')} className="space-y-6">
          <span className="sr-only">{t('loadingNodes')}</span>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Card key={i} className="bg-card border rounded-xl">
                <CardContent className="flex items-center gap-4 py-5">
                  <div className="h-12 w-12 shrink-0 rounded-xl bg-md-surface-container-high animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-16 rounded bg-md-surface-container-high animate-pulse" />
                    <div className="h-6 w-10 rounded bg-md-surface-container-high animate-pulse" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="bg-card border rounded-xl">
            <CardContent className="py-5 space-y-3">
              <div className="h-4 w-32 rounded bg-md-surface-container-high animate-pulse" />
              <div className="h-2 w-full rounded-full bg-md-surface-container-high animate-pulse" />
            </CardContent>
          </Card>
          <Card className="bg-card border rounded-xl">
            <CardContent className="py-5 space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-5 w-full rounded bg-md-surface-container-high animate-pulse" />
              ))}
            </CardContent>
          </Card>
        </div>
      ) : error ? (
        /* Error state — distinguishes backend failure from a truly empty fleet */
        <Card className="bg-card border rounded-xl">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <AlertTriangle aria-hidden="true" className="h-10 w-10 text-md-error" />
            <p className="text-base font-600 text-foreground">{t('loadErrorTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('loadErrorDescription')}</p>
            <Button variant="outline" onClick={loadNodes} className="mt-1">
              {tCommon('refresh')}
            </Button>
          </CardContent>
        </Card>
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
                    <Activity aria-hidden="true" className="h-4 w-4" />
                    <span className="text-sm font-500">{t('onlineRate') || 'Online Rate'}</span>
                  </div>
                  <span className={`font-display text-sm font-600 ${onlinePctTextClass}`}>
                    {onlinePct.toFixed(1)}%
                    <span className="ml-1.5 font-400 text-muted-foreground">
                      ({onlineCount}/{nodes.length})
                    </span>
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={onlineCount}
                  aria-valuemin={0}
                  aria-valuemax={nodes.length}
                  aria-label={t('onlineRateAria', { pct: onlinePct.toFixed(1) })}
                  className="h-2 rounded-full bg-md-surface-container-high overflow-hidden"
                >
                  <div
                    aria-hidden="true"
                    className={`h-full rounded-full transition-all duration-700 ${onlineFillClass}`}
                    style={{
                      width: `${onlinePct}%`,
                      transitionTimingFunction: 'var(--ease-emphasized)',
                    }}
                  />
                </div>
                {isLowHealth && (
                  <p className="mt-2 text-xs text-md-error">{t('lowHealthWarning')}</p>
                )}
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
                <div
                  role="status"
                  className="px-6 pb-8 pt-4 flex flex-col items-center gap-3 text-center"
                >
                  <Server aria-hidden="true" className="h-8 w-8 text-muted-foreground/40" />
                  {nodes.length === 0 ? (
                    <>
                      <p className="text-sm text-muted-foreground">{t('noNodesYet')}</p>
                      <Button variant="outline" size="sm" onClick={() => router.push('/nodes')}>
                        {t('viewNodes')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">{t('noNodesThisWeek')}</p>
                      <Button variant="link" size="sm" onClick={() => router.push('/nodes')}>
                        {t('viewAllNodes')}
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <Table aria-label={t('recentlyRegistered')}>
                  <TableCaption className="sr-only">{t('recentlyRegistered')}</TableCaption>
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
                    {recentNodes.map((n, i) => {
                      const goToDetail = () =>
                        router.push('/nodes/detail?mac=' + encodeURIComponent(n.mac || ''));
                      const statusLabel =
                        n.probe_status === 'online'
                          ? t('statusAria', { status: tNodes('statusOnline') })
                          : n.probe_status === 'offline'
                            ? t('statusAria', { status: tNodes('statusOffline') })
                            : t('statusAria', { status: tNodes('statusUnknown') });
                      return (
                      <TableRow
                        key={n.mac}
                        role="link"
                        tabIndex={0}
                        aria-label={t('viewNodeDetail', { name: n.hostname || n.mac || '' })}
                        onClick={goToDetail}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            goToDetail();
                          }
                        }}
                        className="hover-state cursor-pointer border-b border-border/60 last:border-0 animate-slide-up focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-inset"
                        style={{ animationDelay: `${300 + i * 40}ms` }}
                      >
                        <TableCell className="font-500 text-foreground">
                          {n.hostname || tCommon('noData')}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Globe aria-hidden="true" className="h-3.5 w-3.5" />
                            <span className="text-sm">{n.location || tCommon('noData')}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {getStatusBadge(n.probe_status, statusLabel)}
                            {n.probe_status !== 'online' && n.probe_status !== 'offline' && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    aria-label={t('unknownStatusHint')}
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary rounded-full"
                                  >
                                    <Info aria-hidden="true" className="h-3.5 w-3.5" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>{t('unknownStatusHint')}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {n.tailscale_ip || tCommon('noData')}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(n.registered_at, locale, tCommon('noData'))}
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
    </TooltipProvider>
  );
}
