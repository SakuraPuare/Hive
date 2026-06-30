import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Node, handler_NodeUpdateRequest, model_NodeStatusCheck } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LocationCombobox } from '@/components/ui/location-combobox';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LOCATION_OPTIONS } from '@/lib/locations';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

function formatDateTime(s: string | undefined | null, noData: string) {
  if (!s) return noData;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN');
}

export default function NodeDetail() {
  const router = useRouter();
  const mac = router.query.mac as string | undefined;
  const t = useTranslations('nodeDetail');
  const tCommon = useTranslations('common');

  const [node, setNode] = useState<model_Node | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState('active');
  const [weight, setWeight] = useState(100);
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const noData = tCommon('noData');

  useEffect(() => {
    if (!mac) return;
    setLoading(true);
    sessionApi(AdminService.nodeGet({ mac }))
      .then((n) => {
        setNode(n);
        setLocation(n.location ?? '');
        setNote(n.note ?? '');
        setEnabled(n.enabled ?? true);
        setStatus(n.status ?? 'active');
        setWeight(n.weight ?? 100);
        setRegion(n.region ?? '');
      })
      .catch((e: unknown) => setError(getErrorMessage(e, t('updateFailed'))))
      .finally(() => setLoading(false));
  }, [mac]);

  async function handleSave() {
    if (!mac) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      await sessionApi(
        AdminService.nodeUpdate({
          mac,
          requestBody: { location, note, enabled, status, weight, region } as handler_NodeUpdateRequest,
        }),
      );
      setSaveSuccess(true);
      const updated = await sessionApi(AdminService.nodeGet({ mac }));
      setNode(updated);
    } catch (e) {
      setSaveError(getErrorMessage(e, t('updateFailed')));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 animate-fade-in">
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
      <div className="flex flex-col items-center justify-center gap-3 py-24 animate-fade-in">
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
    <div className="space-y-6">
      {/* Hero header — M3 surface container */}
      <div className="bg-md-surface-container-low border rounded-2xl px-6 py-5 flex items-center gap-4 animate-slide-up elevation-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/nodes')}
          className="state-layer rounded-lg shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {tCommon('back')}
        </Button>
        <div className="h-5 w-px bg-border/60 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-0.5 min-w-0">
          <h1 className="font-display text-2xl font-600 tracking-tight text-foreground truncate">{node.hostname}</h1>
          {node.mac && (
            <span className="text-xs font-mono text-muted-foreground truncate">{formatMac(node.mac)}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '40ms' }}>
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle className="font-display text-base font-600 text-foreground">{t('identifiers')}</CardTitle>
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
            <CardTitle className="font-display text-base font-600 text-foreground">{t('network')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <FieldRow label={t('tailscaleIp')} value={node.tailscale_ip} mono noData={noData} />
            <FieldRow label={t('easytierIp')} value={node.easytier_ip} mono noData={noData} />
            <FieldRow label={t('frpPort')} value={node.frp_port} mono noData={noData} />
          </CardContent>
        </Card>

        <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '120ms' }}>
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle className="font-display text-base font-600 text-foreground">{t('cloudflareTunnel')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <FieldRow label={t('cfUrl')} value={node.cf_url} noData={noData} />
            <FieldRow label={t('tunnelId')} value={node.tunnel_id} mono noData={noData} />
          </CardContent>
        </Card>

        <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '160ms' }}>
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle className="font-display text-base font-600 text-foreground">{t('xray')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <FieldRow label={t('xrayUuid')} value={node.xray_uuid} mono noData={noData} />
          </CardContent>
        </Card>

        <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '200ms' }}>
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle className="font-display text-base font-600 text-foreground">{t('activity')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <FieldRow label={t('registeredAt')} value={formatDateTime(node.registered_at, noData)} noData={noData} />
            <FieldRow label={t('lastSeen')} value={formatDateTime(node.last_seen, noData)} noData={noData} />
          </CardContent>
        </Card>

        <Card className="rounded-xl border bg-card animate-slide-up" style={{ animationDelay: '240ms' }}>
          <CardHeader className="pb-2 pt-5 px-5">
            <CardTitle className="font-display text-base font-600 text-foreground">{t('assetInfo')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <FieldRow label={t('enabled')} value={node.enabled ? '✓' : '✗'} noData={noData} />
            <FieldRow label={t('nodeStatus')} value={node.status} noData={noData} />
            <FieldRow label={t('weight')} value={node.weight} noData={noData} />
            <FieldRow label={t('region')} value={node.region} noData={noData} />
          </CardContent>
        </Card>

        <ProbeStatusCard mac={mac!} t={t} noData={noData} />

        <Card className="md:col-span-2 rounded-xl border bg-md-surface-container-low animate-slide-up" style={{ animationDelay: '280ms' }}>
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="font-display text-base font-600 text-foreground">{t('editNode')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('location')}</Label>
                  <LocationCombobox
                    options={LOCATION_OPTIONS}
                    value={location}
                    onChange={setLocation}
                    placeholder={t('locationPlaceholder')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="detail-note" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('note')}</Label>
                  <Input
                    id="detail-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('notePlaceholder')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('enabled')}</Label>
                  <Select value={enabled ? '1' : '0'} onValueChange={(v) => setEnabled(v === '1')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">✓ {t('enabled')}</SelectItem>
                      <SelectItem value="0">✗ {t('enabled')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('nodeStatus')}</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">{t('statusActive')}</SelectItem>
                      <SelectItem value="maintenance">{t('statusMaintenance')}</SelectItem>
                      <SelectItem value="retired">{t('statusRetired')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="detail-weight" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('weight')}</Label>
                  <Input
                    id="detail-weight"
                    type="number"
                    min={0}
                    max={10000}
                    value={weight}
                    onChange={(e) => setWeight(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="detail-region" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('region')}</Label>
                  <Input id="detail-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder={t('regionPlaceholder')} />
                </div>
              </div>
              <div className="md:col-span-2 space-y-3 pt-1">
                {saveError && (
                  <div className="flex items-center gap-2 rounded-lg bg-md-error-container px-3 py-2.5 text-sm text-md-on-error-container animate-slide-up">
                    <span className="size-1.5 rounded-full bg-md-error shrink-0" aria-hidden="true" />
                    {saveError}
                  </div>
                )}
                {saveSuccess && (
                  <div className="flex items-center gap-2 rounded-lg bg-md-tertiary-container px-3 py-2.5 text-sm text-md-on-tertiary-container animate-slide-up">
                    <span className="size-1.5 rounded-full bg-md-tertiary shrink-0" aria-hidden="true" />
                    {t('saved')}
                  </div>
                )}
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="state-layer ripple w-full rounded-lg px-5 py-2.5 text-sm font-500 bg-md-primary text-md-on-primary elevation-1 hover:elevation-2 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-md-primary focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none"
                >
                  {saving ? tCommon('saving') : t('saveChanges')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ProbeStatusCard({ mac, t, noData }: { mac: string; t: ReturnType<typeof useTranslations>; noData: string }) {
  const [probe, setProbe] = useState<model_NodeStatusCheck | null>(null);

  useEffect(() => {
    if (!mac) return;
    sessionApi(AdminService.adminNodeStatus())
      .then((list) => {
        const found = (list ?? []).find((n) => n.mac === mac);
        if (found) setProbe(found);
      })
      .catch(() => {});
  }, [mac]);

  const ps = probe?.status ?? 'unknown';
  const statusLabel = ({ online: t('probeOnline'), offline: t('probeOffline'), unknown: t('probeUnknown') } as Record<string, string>)[ps] ?? ps;

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
      <CardHeader className="pb-2 pt-5 px-5">
        <CardTitle className="font-display text-base font-600 text-foreground">{t('probeStatus')}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="flex flex-col gap-1 py-2.5 border-b border-border/60">
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
        <FieldRow label={t('probeCheckedAt')} value={probe?.checked_at ? new Date(probe.checked_at + 'Z').toLocaleString() : noData} noData={noData} />
      </CardContent>
    </Card>
  );
}