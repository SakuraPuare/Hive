import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Node, handler_NodeUpdateRequest, model_NodeStatusCheck } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
import { getErrorMessage } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LocationCombobox } from '@/components/ui/location-combobox';
import { useToast } from '@/components/ui/toast';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LOCATION_OPTIONS } from '@/lib/locations';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const WEIGHT_MIN = 0;
const WEIGHT_MAX = 10000;

// §10 semantic status tokens for the maintenance-status field.
const STATUS_DOT: Record<string, string> = {
  active: 'bg-md-tertiary',
  maintenance: 'bg-md-outline',
  retired: 'bg-md-error',
};

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
  const toast = useToast();

  const [node, setNode] = useState<model_Node | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState('active');
  // Keep weight as a string so clearing the field does not silently coerce to 0.
  const [weight, setWeight] = useState('100');
  const [region, setRegion] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [weightError, setWeightError] = useState('');
  // Confirmation gate for the irreversible retire transition.
  const [confirmRetire, setConfirmRetire] = useState(false);

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
        setWeight(String(n.weight ?? 100));
        setRegion(n.region ?? '');
      })
      .catch((e: unknown) => setError(getErrorMessage(e, t('updateFailed'))))
      .finally(() => setLoading(false));
  }, [mac]);

  function validateWeight(): number | null {
    const trimmed = weight.trim();
    if (trimmed === '') {
      setWeightError(t('weightRequired'));
      return null;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < WEIGHT_MIN || n > WEIGHT_MAX) {
      setWeightError(t('weightRange'));
      return null;
    }
    setWeightError('');
    return n;
  }

  async function persist(weightValue: number) {
    if (!mac) return;
    setSaving(true);
    setSaveError('');
    try {
      await sessionApi(
        AdminService.nodeUpdate({
          mac,
          requestBody: { location, note, enabled, status, weight: weightValue, region } as handler_NodeUpdateRequest,
        }),
      );
      toast.success(t('saved'));
      const updated = await sessionApi(AdminService.nodeGet({ mac }));
      setNode(updated);
    } catch (e) {
      const msg = getErrorMessage(e, t('updateFailed'));
      setSaveError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    if (!mac) return;
    const weightValue = validateWeight();
    if (weightValue === null) return;
    // Gate the destructive non-retired → retired transition behind a confirm.
    if (status === 'retired' && node?.status !== 'retired') {
      setConfirmRetire(true);
      return;
    }
    void persist(weightValue);
  }

  async function handleConfirmRetire() {
    const weightValue = validateWeight();
    if (weightValue === null) {
      setConfirmRetire(false);
      return;
    }
    await persist(weightValue);
    setConfirmRetire(false);
  }

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
            <FieldRow label={t('registeredAt')} value={formatDateTime(node.registered_at, noData)} noData={noData} />
            <FieldRow label={t('lastSeen')} value={formatDateTime(node.last_seen, noData)} noData={noData} />
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

        <Card className="md:col-span-2 rounded-xl border bg-md-surface-container-low animate-slide-up" style={{ animationDelay: '280ms' }}>
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle role="heading" aria-level={2} className="font-display text-base font-600 text-foreground">{t('editNode')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSave();
              }}
              className="grid grid-cols-1 gap-4 md:grid-cols-2"
            >
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="detail-location" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('location')}</Label>
                  <LocationCombobox
                    id="detail-location"
                    options={LOCATION_OPTIONS}
                    value={location}
                    onChange={setLocation}
                    placeholder={t('locationPlaceholder')}
                    searchPlaceholder={tCommon('search')}
                    emptyText={tCommon('noResults')}
                    clearable
                    clearLabel={tCommon('clear')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="detail-region" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('region')}</Label>
                  <Input id="detail-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder={t('regionPlaceholder')} helperText={t('regionHelper')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="detail-note" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('note')}</Label>
                  <Textarea
                    id="detail-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('notePlaceholder')}
                    minRows={2}
                    maxRows={6}
                  />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center gap-3 py-1">
                  <Switch
                    id="detail-enabled"
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    onLabel={t('enabledOn')}
                    offLabel={t('enabledOff')}
                  />
                  <Label htmlFor="detail-enabled" className="cursor-pointer text-sm font-500 text-foreground">{t('enabled')}</Label>
                </div>
                <div className="space-y-1.5">
                  <Label id="detail-status-label" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('nodeStatus')}</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger aria-labelledby="detail-status-label">
                      <span className="flex items-center gap-2">
                        <span className={`size-1.5 rounded-full shrink-0 ${STATUS_DOT[status] ?? 'bg-md-outline'}`} aria-hidden="true" />
                        <SelectValue />
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">
                        <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-md-tertiary" aria-hidden="true" />{t('statusActive')}</span>
                      </SelectItem>
                      <SelectItem value="maintenance">
                        <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-md-outline" aria-hidden="true" />{t('statusMaintenance')}</span>
                      </SelectItem>
                      <SelectItem value="retired">
                        <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-md-error" aria-hidden="true" />{t('statusRetired')}</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="detail-weight" className="text-xs font-500 text-muted-foreground uppercase tracking-wide">{t('weight')}</Label>
                  <Input
                    id="detail-weight"
                    type="number"
                    inputMode="numeric"
                    min={WEIGHT_MIN}
                    max={WEIGHT_MAX}
                    step={1}
                    value={weight}
                    onChange={(e) => {
                      setWeight(e.target.value);
                      if (weightError) setWeightError('');
                    }}
                    error={weightError || undefined}
                    helperText={weightError ? undefined : t('weightHelper')}
                  />
                </div>
              </div>
              <div className="md:col-span-2 space-y-3 pt-1">
                {saveError && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="flex items-center gap-2 rounded-lg bg-md-error-container px-3 py-2.5 text-sm text-md-on-error-container animate-slide-up"
                  >
                    <span className="size-1.5 rounded-full bg-md-error shrink-0" aria-hidden="true" />
                    {saveError}
                  </div>
                )}
                <Button type="submit" loading={saving} className="w-full">
                  {t('saveChanges')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmRetire} onOpenChange={(o) => { if (!saving) setConfirmRetire(o); }}>
        <AlertDialogContent pending={saving}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('retireTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('retireDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              destructive
              loading={saving}
              loadingLabel={tCommon('saving')}
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmRetire();
              }}
            >
              {t('retireConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProbeStatusCard({ mac, t, noData }: { mac: string; t: ReturnType<typeof useTranslations>; noData: string }) {
  const [probe, setProbe] = useState<model_NodeStatusCheck | null>(null);
  const [probeLoading, setProbeLoading] = useState(true);
  const [probeError, setProbeError] = useState(false);

  const loadProbe = React.useCallback(() => {
    if (!mac) return;
    setProbeLoading(true);
    setProbeError(false);
    sessionApi(AdminService.adminNodeStatus())
      .then((list) => {
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
        <FieldRow label={t('probeCheckedAt')} value={probe?.checked_at ? new Date(probe.checked_at + 'Z').toLocaleString() : noData} noData={noData} />
      </CardContent>
    </Card>
  );
}