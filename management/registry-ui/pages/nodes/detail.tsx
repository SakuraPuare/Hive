import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getNode, patchNode } from '@/lib/api';
import type { main_Node } from '@/src/generated/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';
import { t } from '@/lib/i18n';

function FieldRow({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  const display = value === null || value === undefined || value === '' ? t.noData : String(value);
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm break-all ${mono ? 'font-mono' : ''}`}>{display}</span>
    </div>
  );
}

function formatDateTime(s: string | undefined | null) {
  if (!s) return t.noData;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN');
}

export default function NodeDetail() {
  const router = useRouter();
  const mac = router.query.mac as string | undefined;
  const [node, setNode] = useState<main_Node | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (!mac) return;
    setLoading(true);
    getNode(mac)
      .then((n) => {
        setNode(n);
        setLocation(n.location ?? '');
        setNote(n.note ?? '');
      })
      .catch((e: any) => setError(e?.error || t.loadFailed))
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
      setSaveError(e?.error || e?.message || t.updateFailed);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-muted-foreground">{t.loading}</p>;
  }

  if (error || !node) {
    return <p className="text-destructive">{error || t.nodeNotFound}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/nodes')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t.back}
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{node.hostname}</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 标识信息 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.identifiers}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label={t.macIpv4} value={node.mac} mono />
            <FieldRow label={t.macIpv6} value={node.mac6} mono />
            <FieldRow label={t.hostname} value={node.hostname} />
            <FieldRow label={t.location} value={node.location} />
            <FieldRow label={t.note} value={node.note} />
          </CardContent>
        </Card>

        {/* 网络 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.network}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label={t.tailscaleIp} value={node.tailscale_ip} mono />
            <FieldRow label={t.easytierIp} value={node.easytier_ip} mono />
            <FieldRow label={t.frpPort} value={node.frp_port} mono />
          </CardContent>
        </Card>

        {/* Cloudflare 隧道 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.cloudflareTunnel}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label={t.cfUrl} value={node.cf_url} />
            <FieldRow label={t.tunnelId} value={node.tunnel_id} mono />
          </CardContent>
        </Card>

        {/* Xray */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.xray}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label={t.xrayUuid} value={node.xray_uuid} mono />
          </CardContent>
        </Card>

        {/* 活动记录 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.activity}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label={t.registeredAt} value={formatDateTime(node.registered_at)} />
            <FieldRow label={t.lastSeen} value={formatDateTime(node.last_seen)} />
          </CardContent>
        </Card>

        {/* 编辑（仅位置和备注） */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.editNode}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="detail-location">{t.location}</Label>
                <Input
                  id="detail-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={t.locationPlaceholder}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="detail-note">{t.note}</Label>
                <Input
                  id="detail-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t.notePlaceholder}
                />
              </div>
              {saveError && <p className="text-sm text-destructive">{saveError}</p>}
              {saveSuccess && <p className="text-sm text-green-600 dark:text-green-400">{t.saved}</p>}
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? t.saving : t.saveChanges}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
