import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AdminService } from '@/src/generated/client';
import type { model_Node, handler_NodeUpdateRequest } from '@/src/generated/client';
import { sessionApi } from '@/lib/openapi-session';
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
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm break-all ${mono ? 'font-mono' : ''}`}>{display}</span>
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
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [tags, setTags] = useState('');
  const [offlineReason, setOfflineReason] = useState('');
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
        setCountry(n.country ?? '');
        setCity(n.city ?? '');
        setTags(n.tags ?? '');
        setOfflineReason(n.offline_reason ?? '');
      })
      .catch((e: any) => setError(e?.error || t('updateFailed')))
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
          requestBody: { location, note, enabled, status, weight, region, country, city, tags, offline_reason: offlineReason } as handler_NodeUpdateRequest,
        }),
      );
      setSaveSuccess(true);
      const updated = await sessionApi(AdminService.nodeGet({ mac }));
      setNode(updated);
    } catch (e: any) {
      setSaveError(e?.error || e?.message || t('updateFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-muted-foreground">{tCommon('loading')}</p>;
  }

  if (error || !node) {
    return <p className="text-destructive">{error || t('nodeNotFound')}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/nodes')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          {tCommon('back')}
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{node.hostname}</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('identifiers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label={t('macIpv4')} value={formatMac(node.mac)} mono noData={noData} />
            <FieldRow label={t('macIpv6')} value={node.mac6} mono noData={noData} />
            <FieldRow label={t('hostname')} value={node.hostname} noData={noData} />
            <FieldRow label={t('location')} value={node.location} noData={noData} />
            <FieldRow label={t('note')} value={node.note} noData={noData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('network')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label={t('tailscaleIp')} value={node.tailscale_ip} mono noData={noData} />
            <FieldRow label={t('easytierIp')} value={node.easytier_ip} mono noData={noData} />
            <FieldRow label={t('frpPort')} value={node.frp_port} mono noData={noData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('cloudflareTunnel')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label={t('cfUrl')} value={node.cf_url} noData={noData} />
            <FieldRow label={t('tunnelId')} value={node.tunnel_id} mono noData={noData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('xray')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label={t('xrayUuid')} value={node.xray_uuid} mono noData={noData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('activity')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label={t('registeredAt')} value={formatDateTime(node.registered_at, noData)} noData={noData} />
            <FieldRow label={t('lastSeen')} value={formatDateTime(node.last_seen, noData)} noData={noData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('assetInfo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label={t('enabled')} value={node.enabled ? '✓' : '✗'} noData={noData} />
            <FieldRow label={t('nodeStatus')} value={node.status} noData={noData} />
            <FieldRow label={t('weight')} value={node.weight} noData={noData} />
            <FieldRow label={t('region')} value={node.region} noData={noData} />
            <FieldRow label={t('country')} value={node.country} noData={noData} />
            <FieldRow label={t('city')} value={node.city} noData={noData} />
            <FieldRow label={t('tags')} value={node.tags} noData={noData} />
            <FieldRow label={t('offlineReason')} value={node.offline_reason} noData={noData} />
          </CardContent>
        </Card>

        <ProbeStatusCard mac={mac!} t={t} noData={noData} />

        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('editNode')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>{t('location')}</Label>
                  <LocationCombobox
                    options={LOCATION_OPTIONS}
                    value={location}
                    onChange={setLocation}
                    placeholder={t('locationPlaceholder')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="detail-note">{t('note')}</Label>
                  <Input
                    id="detail-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('notePlaceholder')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('enabled')}</Label>
                  <Select value={enabled ? '1' : '0'} onValueChange={(v) => setEnabled(v === '1')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">✓ {t('enabled')}</SelectItem>
                      <SelectItem value="0">✗ {t('enabled')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('nodeStatus')}</Label>
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
                  <Label htmlFor="detail-weight">{t('weight')}</Label>
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
                  <Label htmlFor="detail-region">{t('region')}</Label>
                  <Input id="detail-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder={t('regionPlaceholder')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="detail-country">{t('country')}</Label>
                  <Input id="detail-country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder={t('countryPlaceholder')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="detail-city">{t('city')}</Label>
                  <Input id="detail-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder={t('cityPlaceholder')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="detail-tags">{t('tags')}</Label>
                  <Input id="detail-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('tagsPlaceholder')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="detail-offline-reason">{t('offlineReason')}</Label>
                  <Input id="detail-offline-reason" value={offlineReason} onChange={(e) => setOfflineReason(e.target.value)} placeholder={t('offlineReasonPlaceholder')} />
                </div>
              </div>
              <div className="md:col-span-2">
                {saveError && <p className="text-sm text-destructive mb-2">{saveError}</p>}
                {saveSuccess && <p className="text-sm text-green-600 dark:text-green-400 mb-2">{t('saved')}</p>}
                <Button onClick={handleSave} disabled={saving} className="w-full">
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

function ProbeStatusCard({ mac, t, noData }: { mac: string; t: any; noData: string }) {
  const [probe, setProbe] = useState<any>(null);

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
  const dotClass = ps === 'online' ? 'bg-green-500' : ps === 'offline' ? 'bg-red-500' : 'bg-gray-400';

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
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('probeStatus')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-0.5 py-2 border-b">
          <span className="text-xs text-muted-foreground">{t('probeStatus')}</span>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
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