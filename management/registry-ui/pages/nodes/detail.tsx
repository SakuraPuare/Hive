import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getNode, patchNode } from '@/lib/api';
import type { main_Node } from '@/src/generated/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LocationCombobox } from '@/components/ui/location-combobox';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LOCATION_OPTIONS } from '@/lib/locations';

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

  const [node, setNode] = useState<main_Node | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  const noData = tCommon('noData');

  useEffect(() => {
    if (!mac) return;
    setLoading(true);
    getNode(mac)
      .then((n) => {
        setNode(n);
        setLocation(n.location ?? '');
        setNote(n.note ?? '');
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
      await patchNode(mac, { location, note });
      setSaveSuccess(true);
      const updated = await getNode(mac);
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
            <CardTitle className="text-base">{t('editNode')}</CardTitle>
          </CardHeader>
          <CardContent>
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
              {saveError && <p className="text-sm text-destructive">{saveError}</p>}
              {saveSuccess && <p className="text-sm text-green-600 dark:text-green-400">{t('saved')}</p>}
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? tCommon('saving') : t('saveChanges')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
