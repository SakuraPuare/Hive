import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { getNode, patchNode } from '@/lib/api';
import type { main_Node } from '@/src/generated/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft } from 'lucide-react';

function FieldRow({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  const display = value === null || value === undefined || value === '' ? '—' : String(value);
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm break-all ${mono ? 'font-mono' : ''}`}>{display}</span>
    </div>
  );
}

export default function NodeDetail() {
  const router = useRouter();
  const mac = router.query.mac as string | undefined;
  const [node, setNode] = useState<main_Node | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit state
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [tailscaleIp, setTailscaleIp] = useState('');
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
        setTailscaleIp(n.tailscale_ip ?? '');
      })
      .catch((e: any) => setError(e?.error || 'Failed to load node'))
      .finally(() => setLoading(false));
  }, [mac]);

  async function handleSave() {
    if (!mac) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess(false);
    try {
      await patchNode(mac, { location, note, tailscale_ip: tailscaleIp });
      setSaveSuccess(true);
      const updated = await getNode(mac);
      setNode(updated);
    } catch (e: any) {
      setSaveError(e?.error || e?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  if (error || !node) {
    return <p className="text-destructive">{error || 'Node not found'}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/nodes')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{node.hostname}</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Identifiers */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Identifiers</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label="MAC (IPv4)" value={node.mac} mono />
            <FieldRow label="MAC (IPv6)" value={node.mac6} mono />
            <FieldRow label="Hostname" value={node.hostname} />
            <FieldRow label="Location" value={node.location} />
            <FieldRow label="Note" value={node.note} />
          </CardContent>
        </Card>

        {/* Network */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Network</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label="Tailscale IP" value={node.tailscale_ip} mono />
            <FieldRow label="EasyTier IP" value={node.easytier_ip} mono />
            <FieldRow label="FRP Port" value={node.frp_port} mono />
          </CardContent>
        </Card>

        {/* Cloudflare */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cloudflare Tunnel</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label="CF URL" value={node.cf_url} />
            <FieldRow label="Tunnel ID" value={node.tunnel_id} mono />
          </CardContent>
        </Card>

        {/* Xray */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Xray</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label="UUID" value={node.xray_uuid} mono />
          </CardContent>
        </Card>

        {/* Timestamps */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldRow label="Registered At" value={node.registered_at} />
            <FieldRow label="Last Seen" value={node.last_seen} />
          </CardContent>
        </Card>

        {/* Edit */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Edit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="detail-location">Location</Label>
                <Input
                  id="detail-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="detail-note">Note</Label>
                <Input
                  id="detail-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="detail-tailscale">Tailscale IP</Label>
                <Input
                  id="detail-tailscale"
                  value={tailscaleIp}
                  onChange={(e) => setTailscaleIp(e.target.value)}
                  className="font-mono"
                  placeholder="pending"
                />
              </div>
              {saveError && <p className="text-sm text-destructive">{saveError}</p>}
              {saveSuccess && <p className="text-sm text-green-600 dark:text-green-400">Saved.</p>}
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
