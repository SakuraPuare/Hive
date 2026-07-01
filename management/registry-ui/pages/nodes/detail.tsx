import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Node, model_NodeStatusCheck } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContainer } from '@/components/ui/page-container';
import { PageHeader } from '@/components/ui/page-header';
import { NodeEditDialog } from '@/components/nodes/NodeEditDialog';
import { ArrowLeft, RefreshCw, Pencil, Server } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/lib/format';

function FieldRow({ label, value, mono, noData }: { label: string; value?: string | number | null; mono?: boolean; noData: string }) {
  const display = value === null || value === undefined || value === '' ? noData : String(value);
  const isEmpty = display === noData;
  return (
    <div className="flex flex-col gap-1 py-2.5 border-b border-border/60 last:border-b-0">
      <span className="text-xs font-500 text-muted-foreground uppercase tracking-wide leading-none">{label}</span>
      <span className={`text-sm break-all leading-snug ${mono ? 'font-mono text-xs' : ''} ${isEmpty ? 'text-muted-foreground/60 italic' : 'text-foreground'}`}>
        {display}
      </span>
    </div>
  );
}

function formatMac(mac: string | undefined | null) {
  if (!mac || mac.length !== 12) return mac ?? '';
  return mac.match(/.{2}/g)!.join(':');
}

export default function NodeDetail() {
  const router = useRouter();
  const mac = router.query.mac as string | undefined;
  const t = useTranslations('nodeDetail');
  const tCommon = useTranslations('common');
  const fmt = useFormat();

  const [node, setNode] = useState<model_Node | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);

  const noData = tCommon('noData');

  const load = React.useCallback(() => {
    if (!mac) return;
    setLoading(true);
    sessionApi(AdminService.nodeGet({ mac }))
      .then((n) => setNode(n))
      .catch((e: unknown) => setError(getErrorMessage(e, t('updateFailed'))))
      .finally(() => setLoading(false));
  }, [mac, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 animate-fade-in" role="status" aria-live="polite">
        {/* M3 circular progress indicator */}
        <div className="relative h-12 w-12">
          <svg className="animate-spin h-12 w-12" viewBox="0 0 48 48" fill="none" aria-hidden="true">
            <circle
              cx="24" cy="24" r="20"
              stroke="hsl(var(--md-outline-variant))"
              strokeWidth="4"
            />
            <circle
              cx="24" cy="24" r="20"
              stroke="hsl(var(--md-primary))"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="80 46"
            />
          </svg>
        </div>
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      </div>
    );
  }

  if (error || !node) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 animate-fade-in" role="alert">
        <div className="rounded-full bg-md-error-container p-3">
          <svg className="h-6 w-6 text-md-on-error-container" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="text-sm font-500 text-destructive">{error || t('nodeNotFound')}</p>
      </div>
    );
  }

  return (
    <PageContainer width="content">
      {/* Back button */}
      <Button variant="ghost" onClick={() => router.push('/nodes')} className="-ml-1">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span>{tCommon('back')}</span>
      </Button>

      <PageHeader
        icon={<Server aria-hidden="true" />}
        title={node.note || node.hostname}
        description={
          node.mac ? (
            <span className="font-mono">{formatMac(node.mac)}</span>
          ) : undefined
        }
        actions={
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('editNode')}</span>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '40ms' }}>
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle role="heading" aria-level={2} className="font-display text-base font-600 text-foreground">{t('identifiers')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <FieldRow label={t('macIpv4')} value={formatMac(node.mac)} mono noData={noData} />
            <FieldRow label={t('macIpv6')} value={node.mac6} mono noData={noData} />
            <FieldRow label={t('hostname')} value={node.hostname} noData={noData} />
            <FieldRow label={t('location')} value={node.location} noData={noData} />
            <FieldRow label={t('note')} value={node.note} noData={noData} />
          </CardContent>
        </Card>

        <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '80ms' }}>
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle role="heading" aria-level={2} className="font-display text-base font-600 text-foreground">{t('network')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <FieldRow label={t('tailscaleIp')} value={node.tailscale_ip} mono noData={noData} />
            <FieldRow label={t('easytierIp')} value={node.easytier_ip} mono noData={noData} />
            <FieldRow label={t('frpPort')} value={node.frp_port} mono noData={noData} />
          </CardContent>
        </Card>

        <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '120ms' }}>
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle role="heading" aria-level={2} className="font-display text-base font-600 text-foreground">{t('cloudflareTunnel')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <FieldRow label={t('cfUrl')} value={node.cf_url} noData={noData} />
            <FieldRow label={t('tunnelId')} value={node.tunnel_id} mono noData={noData} />
          </CardContent>
        </Card>

        <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '160ms' }}>
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle role="heading" aria-level={2} className="font-display text-base font-600 text-foreground">{t('xray')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <FieldRow label={t('xrayUuid')} value={node.xray_uuid} mono noData={noData} />
          </CardContent>
        </Card>

        <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '200ms' }}>
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle role="heading" aria-level={2} className="font-display text-base font-600 text-foreground">{t('activity')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <FieldRow label={t('registeredAt')} value={fmt.dateTime(node.registered_at, noData)} noData={noData} />
            <FieldRow label={t('lastSeen')} value={fmt.dateTime(node.last_seen, noData)} noData={noData} />
          </CardContent>
        </Card>

        <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '240ms' }}>
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle role="heading" aria-level={2} className="font-display text-base font-600 text-foreground">{t('assetInfo')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <FieldRow label={t('enabled')} value={node.enabled ? t('enabledOn') : t('enabledOff')} noData={noData} />
            <FieldRow label={t('nodeStatus')} value={node.status} noData={noData} />
            <FieldRow label={t('weight')} value={node.weight} noData={noData} />
            <FieldRow label={t('region')} value={node.region} noData={noData} />
          </CardContent>
        </Card>

        <ProbeStatusCard mac={mac!} t={t} noData={noData} />
      </div>

      <NodeEditDialog
        key={`${node?.mac ?? 'none'}-${editOpen}`}
        node={node}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={(updated) => setNode(updated)}
      />
    </PageContainer>
  );
}

function ProbeStatusCard({ mac, t, noData }: { mac: string; t: ReturnType<typeof useTranslations>; noData: string }) {
  const fmt = useFormat();
  const [probe, setProbe] = useState<model_NodeStatusCheck | null>(null);
  const [probeLoading, setProbeLoading] = useState(true);
  const [probeError, setProbeError] = useState(false);

  const loadProbe = React.useCallback(() => {
    if (!mac) return;
    setProbeLoading(true);
    setProbeError(false);
    sessionApi(AdminService.adminNodeStatus())
      .then((list) => {
        // TODO: adminNodeStatus() fetches ALL nodes (full-table JOIN in probe.go).
        // When node count grows beyond ~100 this single request grows linearly.
        // Backend should expose a mac= query param so detail pages can fetch one node.
        const found = (list ?? []).find((n) => n.mac === mac);
        setProbe(found ?? null);
      })
      .catch(() => setProbeError(true))
      .finally(() => setProbeLoading(false));
  }, [mac]);

  useEffect(() => {
    loadProbe();
  }, [loadProbe]);

  const ps = probeError ? 'unknown' : probe?.status ?? 'unknown';
  const statusLabel = probeError
    ? t('probeFetchFailed')
    : ({ online: t('probeOnline'), offline: t('probeOffline'), unknown: t('probeUnknown') } as Record<string, string>)[ps] ?? ps;

  // §10 semantic status tokens: online=tertiary, offline=error, unknown=idle
  const statusChipClass =
    ps === 'online'
      ? 'bg-md-tertiary-container text-md-on-tertiary-container'
      : ps === 'offline'
        ? 'bg-md-error-container text-md-on-error-container'
        : 'bg-muted text-muted-foreground';
  const statusDotClass =
    ps === 'online' ? 'bg-md-tertiary' : ps === 'offline' ? 'bg-md-error' : 'bg-md-outline';

  function fmtUptime(sec: number | null | undefined): string {
    if (sec == null) return noData;
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    if (d > 0) return `${d}d ${h}h`;
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function fmtPct(v: number | null | undefined): string {
    if (v == null) return noData;
    return `${v.toFixed(1)}%`;
  }

  return (
    <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '280ms' }}>
      <CardHeader className="pb-2 pt-5 px-5 flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle role="heading" aria-level={2} className="font-display text-base font-600 text-foreground">{t('probeStatus')}</CardTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={loadProbe}
          loading={probeLoading}
          aria-label={t('refreshProbe')}
        >
          {!probeLoading && <RefreshCw className="size-4" aria-hidden="true" />}
        </Button>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="flex flex-col gap-1 py-2.5 border-b border-border/60" aria-live="polite">
          <span className="text-xs font-500 text-muted-foreground uppercase tracking-wide leading-none">{t('probeStatus')}</span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-500 w-fit mt-1 ${statusChipClass}`}>
            <span className={`size-1.5 rounded-full ${statusDotClass}`} aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
        <FieldRow label={t('probeCpu')} value={fmtPct(probe?.cpu_pct)} noData={noData} />
        <FieldRow label={t('probeMem')} value={fmtPct(probe?.mem_pct)} noData={noData} />
        <FieldRow label={t('probeDisk')} value={fmtPct(probe?.disk_pct)} noData={noData} />
        <FieldRow label={t('probeUptime')} value={fmtUptime(probe?.uptime_sec)} noData={noData} />
        <FieldRow label={t('probeLatency')} value={probe?.latency_ms != null ? `${probe.latency_ms}ms` : noData} noData={noData} />
        <FieldRow label={t('probeCheckedAt')} value={probe?.checked_at ? fmt.dateTime(probe.checked_at.replace(' ', 'T') + 'Z', noData) : noData} noData={noData} />
      </CardContent>
    </Card>
  );
}